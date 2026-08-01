"""三类作业：摄取 Phase A / Phase B / 站点数据生成。

管道脚本不烘进镜像，每次从仓库稀疏浅克隆 `.github/` 取用，改脚本无需重建镜像；
镜像只提供运行时（ffmpeg / tesseract / Python 依赖）。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import gh
import pack
import store

REPO = os.environ.get("GH_REPO", "wuyilingwei/LRC")
LYRIC_MAKER = os.environ.get("LYRIC_MAKER", "")
BOT_NAME = "lrc-ingest[bot]"
BOT_EMAIL = "lrc-ingest@users.noreply.github.com"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(cmd: list[str], log, *, cwd: Path | None = None, env: dict | None = None,
        redact: str = "") -> str:
    shown = " ".join(cmd)
    if redact:
        shown = shown.replace(redact, "***")
    log(f"$ {shown}")
    proc = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})},
                          capture_output=True, text=True)
    tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-40:]
    for line in tail:
        log(f"  {line}")
    if proc.returncode != 0:
        raise RuntimeError(f"命令失败({proc.returncode}): {shown}")
    return proc.stdout


def _clone_scripts(work: Path, log) -> Path:
    """只取 .github/：管道脚本与配置，几 MB，不碰 res/pack 等大目录。"""
    repo = work / "repo"
    run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
         f"https://github.com/{REPO}.git", str(repo)], log)
    run(["git", "-C", str(repo), "sparse-checkout", "set", ".github"], log)
    return repo


def _clone_full(work: Path, log) -> Path:
    """生成作业要读遍 res/ 并写回 docs/pack，需要完整工作树（无历史）。"""
    repo = work / "repo"
    token = gh.TOKEN
    url = f"https://x-access-token:{token}@github.com/{REPO}.git"
    run(["git", "clone", "--depth", "1", url, str(repo)], log, redact=token)
    run(["git", "-C", str(repo), "config", "user.name", BOT_NAME], log)
    run(["git", "-C", str(repo), "config", "user.email", BOT_EMAIL], log)
    return repo


def _pipeline_env(repo: Path) -> dict:
    return {"PYTHONPATH": str(repo / ".github" / "scripts")}


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def phase_a(params: dict, log) -> dict:
    """原料 → 成品草稿 bundle，停在人工闸门。"""
    ref = params["ref"]
    manifest = store.get_json(f"web/{ref}/manifest.json") or {}
    album = manifest.get("album") or ""
    files = manifest.get("files") or []
    contributor = manifest.get("contributor") or "web"
    if not album or not files:
        raise RuntimeError(f"取料清单缺 album/files: web/{ref}/manifest.json")

    work = Path(tempfile.mkdtemp(prefix="phase-a-"))
    try:
        payload = work / "payload" / album
        total = 0
        for f in files:
            total += store.download(f"web/{ref}/{f['n']}", payload / f["path"],
                                    int(f.get("size") or 0))
        log(f"取料 {len(files)} 个文件 / {total} 字节 → payload/{album}/")

        repo = _clone_scripts(work, log)
        res_dir = repo / "res"
        res_dir.mkdir(parents=True, exist_ok=True)
        pulled = gh.pull_album(album, res_dir)
        if pulled:
            log(f"已有专辑「{album}」{len(pulled)} 个文件 → 增补模式")

        bundle_root = work / "bundle"
        summary_path = work / "summary.json"
        cmd = ["python", "-m", "ingest.pipeline", "--phase", "a",
               "--src", str(work / "payload"), "--res-dir", str(res_dir),
               "--bundle-root", str(bundle_root), "--timestamp", _now(),
               "--work", str(work / "ingest_work"), "--json", str(summary_path),
               "--contributor", contributor]
        if LYRIC_MAKER:
            cmd += ["--lyric-maker", LYRIC_MAKER]
        run(cmd, log, cwd=repo, env=_pipeline_env(repo))

        summary = _read_json(summary_path)
        if not bundle_root.is_dir() or not any(bundle_root.iterdir()):
            log("Phase A 未产出 bundle")
            return {"result": "empty", "summary": summary}

        keys = store.put_tree(bundle_root, f"review/{ref}")
        log(f"草稿 {len(keys)} 个对象 → review/{ref}/")
        return {"result": "ok", "album": summary.get("album", album),
                "objects": len(keys), "summary": summary}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def phase_b(params: dict, log) -> dict:
    """（可能被人工校正过的）草稿 → res/<专辑>/ → 开 PR 走审计。"""
    ref = params["ref"]

    work = Path(tempfile.mkdtemp(prefix="phase-b-"))
    try:
        review = work / "review"
        got = store.get_tree(f"review/{ref}", review)
        if not got:
            log(f"review/{ref}/ 不存在（已被处理或丢弃），跳过")
            return {"result": "empty"}

        repo = _clone_scripts(work, log)
        res_dir = repo / "res"
        res_dir.mkdir(parents=True, exist_ok=True)

        summary_path = work / "summary.json"
        run(["python", "-m", "ingest.pipeline", "--phase", "b",
             "--bundle-root", str(review), "--res-dir", str(res_dir),
             "--json", str(summary_path)], log, cwd=repo, env=_pipeline_env(repo))
        summary = _read_json(summary_path)
        # album 是给人看的合并串（多张专辑用顿号连），落盘要按 albums 逐张来
        album = summary.get("album", "")
        names = [a.get("album") for a in (summary.get("albums") or [])
                 if a.get("result") == "ok" and a.get("album")]
        if not names or summary.get("result") != "ok":
            log("Phase B 未产出 res 改动")
            return {"result": "empty", "summary": summary}

        status = {}
        for st in sorted(review.rglob("status.json")):
            status = _read_json(st)
            break
        contributor = status.get("contributor") or "web"
        is_update = bool(summary.get("is_update"))

        for name in names:
            try:
                run(["python", ".github/scripts/fetch_bilibili_meta.py", "--album", name,
                     "--auto", "--fields", "release,year,electronic"],
                    log, cwd=repo, env=_pipeline_env(repo))
            except RuntimeError as e:
                log(f"补发行元信息失败（不阻断）：{e}")

        verb = "update" if is_update else "ingest"
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        slug = "".join(c if c.isalnum() or c == "-" else "-" for c in contributor.lower()).strip("-")
        branch = f"ingest-{slug or 'web'}-{ts}"
        pushed = gh.commit_albums(names, res_dir, branch=branch,
                                  message=f"{verb}: {album} (via upload by @{contributor})")
        if not pushed:
            log("与 main 内容一致，无需开 PR")
            return {"result": "nochange", "album": album, "summary": summary}

        body = "\n".join([
            f"### 自动摄取 — {'增补已有专辑数据' if is_update else '新专辑摄取投稿（经人工闸门校正）'}",
            "",
            f"- 投稿者：@{contributor}",
            f"- 专辑：`{album}`",
            f"- ref：`{ref}`",
            f"- 来源：网页投稿 → Phase A 草稿 → 人工闸门 → Phase B 对齐（原料仅存 R2，30 天后自动清理）",
            "",
            "<details><summary>处理摘要</summary>",
            "",
            "```json",
            json.dumps(summary, ensure_ascii=False, indent=2),
            "```",
            "</details>",
            "",
            "> 歌词为机器转写、meta 为模型抽取，已经人工闸门校正；仍请复核后再依赖自动合并。",
        ])
        pr = gh.open_pr(branch, f"{verb}: {album} (@{contributor})", body)
        log(f"已开 PR #{pr.get('number')} ← {branch}")

        store.put_json(f"web/{ref}/.used",
                       {"ref": ref, "album": album, "used_at": _now()})
        removed = store.delete_prefix(f"review/{ref}/")
        log(f"已标记原料 .used 并清理 review/{ref}/（{removed} 个对象）")

        return {"result": "ok", "album": album, "pr": pr.get("number"),
                "branch": branch, "summary": summary}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def generate(params: dict, log) -> dict:
    """res/ → meta 补全 / 压缩包 / 目录页 / 静态 API / 报告，提交回 main 并触发部署。"""
    force = bool(params.get("force"))

    work = Path(tempfile.mkdtemp(prefix="generate-"))
    try:
        repo = _clone_full(work, log)
        env = _pipeline_env(repo)

        run(["python", ".github/scripts/generate_meta.py"], log, cwd=repo, env=env)

        result = pack.rebuild(repo / "res", repo / "pack", force=force)
        log(f"压缩包：新建/更新 {len(result['built'])}、清理 {len(result['removed'])}、"
            f"跳过 {result['skipped']}")

        run(["python", ".github/scripts/optimize.py"], log, cwd=repo, env=env)

        albums_dir = repo / "docs" / "albums"
        shutil.rmtree(albums_dir, ignore_errors=True)
        albums_dir.mkdir(parents=True, exist_ok=True)

        for script in ("generate_md.py", "generate_api.py", "generate_report.py"):
            run(["python", f".github/scripts/{script}"], log, cwd=repo, env=env)

        run(["git", "add", "README.md", "pack", "docs", "res"], log, cwd=repo)
        changed = run(["git", "status", "--porcelain"], log, cwd=repo).strip()
        if not changed:
            log("无生成物变化")
            return {"result": "nochange"}

        run(["git", "commit", "-m", "chore: optimize tags, update catalog and generate pages"],
            log, cwd=repo)
        run(["git", "push", "origin", "HEAD:main"], log, cwd=repo, redact=gh.TOKEN)

        gh.dispatch_workflow("deploy.yml")
        log("已触发站点构建部署")
        return {"result": "ok", "packs": result}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def diag(params: dict, log) -> dict:
    """自检：确认镜像里该有的外部命令都在，并打通一次对象存储往返。"""
    versions = {}
    for name, cmd in (("python", ["python", "-V"]), ("ffmpeg", ["ffmpeg", "-version"]),
                      ("ffprobe", ["ffprobe", "-version"]), ("git", ["git", "--version"]),
                      ("tesseract", ["tesseract", "--version"])):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            versions[name] = (out.stdout or out.stderr).strip().splitlines()[0]
        except Exception as e:  # noqa: BLE001
            versions[name] = f"缺失: {e}"

    probe_key = "review/.diag/probe"
    payload = json.dumps({"at": _now()}).encode("utf-8")
    store.put_bytes(probe_key, payload)
    ok = store.get_bytes(probe_key) == payload
    store.delete_prefix("review/.diag/")
    log(f"对象存储往返：{'一致' if ok else '不一致'}")

    return {"result": "ok" if ok else "store-mismatch", "versions": versions,
            "repo": REPO, "lyric_maker_set": bool(LYRIC_MAKER),
            "gh_token_set": bool(gh.TOKEN), "llm_key_set": bool(os.environ.get("LLM_API_KEY"))}


HANDLERS = {"phase_a": phase_a, "phase_b": phase_b, "generate": generate, "diag": diag}
