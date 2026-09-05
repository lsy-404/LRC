"""GitHub REST 访问：读单张专辑现状、缝树提交开 PR、触发 workflow。

仓库只当数据存储用，不做全量克隆——摄取只需要目标专辑那几个文件。
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.github.com"
REPO = os.environ.get("GH_REPO", "lsy-404/LRC")
TOKEN = os.environ.get("GH_TOKEN", "")
TIMEOUT = 120


def _headers(extra: dict | None = None) -> dict:
    h = {
        "accept": "application/vnd.github+json",
        "user-agent": "lrc-ingest-runner",
        "x-github-api-version": "2022-11-28",
    }
    if TOKEN:
        h["authorization"] = f"Bearer {TOKEN}"
    h.update(extra or {})
    return h


def api(method: str, path: str, body=None, allow_404: bool = False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    extra = {"content-type": "application/json"} if data else {}
    req = urllib.request.Request(f"{API}{path}", method=method, data=data, headers=_headers(extra))
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as e:
        if allow_404 and e.code == 404:
            return None
        detail = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"GitHub {method} {path} -> {e.code}: {detail}") from None


def _enc(path: str) -> str:
    return "/".join(urllib.parse.quote(seg) for seg in path.split("/"))


def list_dir(path: str, ref: str = "main") -> list[dict]:
    out = api("GET", f"/repos/{REPO}/contents/{_enc(path)}?ref={ref}", allow_404=True)
    return out if isinstance(out, list) else []


def read_file(path: str, ref: str = "main") -> bytes | None:
    out = api("GET", f"/repos/{REPO}/contents/{_enc(path)}?ref={ref}", allow_404=True)
    if not isinstance(out, dict) or "content" not in out:
        return None
    return base64.b64decode(out["content"])


def pull_album(album: str, res_dir: Path, ref: str = "main") -> list[str]:
    """把 res/<album>/ 现有文件取到本地 res_dir/<album>/。

    Phase A 只靠目录是否存在 + meta.toml 判断增补，故只取文本类小文件，
    封面等二进制不取（增补不需要，且白占带宽）。
    """
    entries = list_dir(f"res/{album}", ref)
    if not entries:
        return []
    got = []
    for e in entries:
        if e.get("type") != "file":
            continue
        name = e.get("name", "")
        if not name.endswith((".toml", ".lrc", ".klrc", ".txt")):
            continue
        blob = read_file(f"res/{album}/{name}", ref)
        if blob is None:
            continue
        dest = res_dir / album / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        got.append(name)
    return got


def _blob(content: bytes) -> str:
    out = api("POST", f"/repos/{REPO}/git/blobs", {
        "content": base64.b64encode(content).decode("ascii"), "encoding": "base64"})
    return out["sha"]


def commit_albums(albums: list[str], res_dir: Path, *, branch: str, message: str,
                  base: str = "main") -> dict | None:
    """把这些专辑目录落地为 base 之上的一个新分支单提交。无实际改动时返回 None。

    只增改不删：增补投稿只覆盖本次上传的文件，未涉及的既有歌词必须原样留在库里。
    """
    local: dict[str, bytes] = {}
    for album in albums:
        album_dir = res_dir / album
        if not album_dir.is_dir():
            continue
        for p in sorted(album_dir.rglob("*")):
            if p.is_file():
                local[f"res/{album}/{p.relative_to(album_dir).as_posix()}"] = p.read_bytes()
    if not local:
        return None

    head = api("GET", f"/repos/{REPO}/git/ref/heads/{base}")
    base_sha = head["object"]["sha"]
    base_tree = api("GET", f"/repos/{REPO}/git/commits/{base_sha}")["tree"]["sha"]

    entries = [{"path": path, "mode": "100644", "type": "blob", "sha": _blob(content)}
               for path, content in local.items()]

    tree = api("POST", f"/repos/{REPO}/git/trees", {"base_tree": base_tree, "tree": entries})
    if tree["sha"] == base_tree:
        return None

    commit = api("POST", f"/repos/{REPO}/git/commits",
                 {"message": message, "tree": tree["sha"], "parents": [base_sha]})
    api("POST", f"/repos/{REPO}/git/refs",
        {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
    return {"commit": commit["sha"], "branch": branch, "files": len(local)}


def open_pr(branch: str, title: str, body: str, base: str = "main") -> dict:
    return api("POST", f"/repos/{REPO}/pulls",
               {"title": title, "head": branch, "base": base, "body": body})


def dispatch_workflow(workflow_file: str, ref: str = "main") -> None:
    api("POST", f"/repos/{REPO}/actions/workflows/{workflow_file}/dispatches", {"ref": ref})
