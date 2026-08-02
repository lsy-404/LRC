"""对象存储访问：容器内没有 R2 绑定，统一经编排 Worker 的 /store 端点读写。"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

WORKER_URL = os.environ.get("WORKER_URL", "").rstrip("/")
TOKEN = os.environ.get("INGEST_TOKEN", "")
TIMEOUT = 300


def _req(method: str, key: str, *, data=None, query: dict | None = None):
    if not WORKER_URL or not TOKEN:
        raise RuntimeError("缺 WORKER_URL / INGEST_TOKEN")
    url = f"{WORKER_URL}/store/{urllib.parse.quote(key)}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("authorization", f"Bearer {TOKEN}")
    # 标准库默认 UA 是 Python-urllib/x，会被区域的机器人防护当爬虫拦成 403
    req.add_header("user-agent", "lrc-ingest-runner")
    if data is not None:
        req.add_header("content-type", "application/octet-stream")
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def get_bytes(key: str) -> bytes | None:
    try:
        with _req("GET", key) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def get_json(key: str):
    raw = get_bytes(key)
    return json.loads(raw.decode("utf-8")) if raw else None


def download(key: str, dest: Path, expect_size: int = 0) -> int:
    """流式落盘；expect_size > 0 时校验字节数，防截断的流被当成完整原料。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with _req("GET", key) as resp, dest.open("wb") as fh:
        got = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            got += len(chunk)
    if expect_size and got != expect_size:
        raise RuntimeError(f"取料字节数不符: {key} 期望 {expect_size} 实得 {got}")
    return got


def put_bytes(key: str, data: bytes) -> None:
    _req("PUT", key, data=data).close()


def put_json(key: str, obj) -> None:
    put_bytes(key, json.dumps(obj, ensure_ascii=False).encode("utf-8"))


def put_tree(local_dir: Path, prefix: str) -> list[str]:
    """把本地目录整棵传到 prefix 下，返回写入的 key。"""
    keys = []
    for p in sorted(local_dir.rglob("*")):
        if not p.is_file():
            continue
        key = f"{prefix.rstrip('/')}/{p.relative_to(local_dir).as_posix()}"
        put_bytes(key, p.read_bytes())
        keys.append(key)
    return keys


def list_keys(prefix: str) -> list[dict]:
    with _req("GET", "", query={"prefix": prefix}) as resp:
        return json.loads(resp.read().decode("utf-8")).get("keys", [])


def get_tree(prefix: str, dest: Path) -> list[str]:
    """把 prefix 下所有对象取回 dest，保留相对层级。"""
    prefix = prefix.rstrip("/") + "/"
    out = []
    for item in list_keys(prefix):
        rel = item["key"][len(prefix):]
        if not rel:
            continue
        download(item["key"], dest / rel)
        out.append(rel)
    return out


def delete_prefix(prefix: str) -> int:
    with _req("DELETE", "", query={"prefix": prefix}) as resp:
        return json.loads(resp.read().decode("utf-8")).get("deleted", 0)
