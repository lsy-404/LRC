#!/usr/bin/env python3
"""容器冒烟测试：起一个假的 /store 端点，让真实容器跑一次 diag 作业。

覆盖 server.py 的作业登记/轮询、store.py 的读写往返、镜像里外部命令是否齐全。
需要本机 Docker，且镜像已构建：
    docker build --platform linux/amd64 -f runner/Dockerfile -t lrc-runner:test .
运行：
    python3 test/runner/test_container_diag.py
"""
from __future__ import annotations

import json
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

IMAGE = "lrc-runner:test"
TOKEN = "test-token"
STORE_PORT = 8788
CONTAINER_PORT = 18080

_objects: dict[str, bytes] = {}


class StoreHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _auth(self) -> bool:
        return self.headers.get("authorization") == f"Bearer {TOKEN}"

    def _send(self, status: int, body: bytes, ctype="application/json"):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _key(self) -> str:
        return self.path.split("?")[0][len("/store/"):]

    def _prefix(self) -> str | None:
        if "?" not in self.path:
            return None
        from urllib.parse import parse_qs
        return (parse_qs(self.path.split("?", 1)[1]).get("prefix") or [None])[0]

    def do_GET(self):
        if not self._auth():
            return self._send(401, b'{"error":"unauthorized"}')
        prefix = self._prefix()
        if prefix is not None:
            keys = [{"key": k, "size": len(v)} for k, v in _objects.items() if k.startswith(prefix)]
            return self._send(200, json.dumps({"keys": keys}).encode())
        from urllib.parse import unquote
        key = unquote(self._key())
        if key not in _objects:
            return self._send(404, b'{"error":"not found"}')
        return self._send(200, _objects[key], "application/octet-stream")

    def do_PUT(self):
        if not self._auth():
            return self._send(401, b'{"error":"unauthorized"}')
        from urllib.parse import unquote
        data = self.rfile.read(int(self.headers.get("content-length") or 0))
        _objects[unquote(self._key())] = data
        return self._send(200, json.dumps({"ok": True, "size": len(data)}).encode())

    def do_DELETE(self):
        if not self._auth():
            return self._send(401, b'{"error":"unauthorized"}')
        prefix = self._prefix()
        if prefix is None:
            from urllib.parse import unquote
            _objects.pop(unquote(self._key()), None)
            return self._send(200, b'{"ok":true}')
        gone = [k for k in _objects if k.startswith(prefix)]
        for k in gone:
            _objects.pop(k)
        return self._send(200, json.dumps({"deleted": len(gone)}).encode())


def _post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(url, method="POST",
                                 data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json"})
    return _open(req)


def _get(url: str) -> dict:
    return _open(urllib.request.Request(url))


def _open(req) -> dict:
    """错误码也要能读到正文，拒绝分支才验得了。"""
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def main() -> int:
    server = ThreadingHTTPServer(("0.0.0.0", STORE_PORT), StoreHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    name = "lrc-runner-diag"
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    subprocess.run([
        "docker", "run", "-d", "--rm", "--name", name, "--platform", "linux/amd64",
        "-p", f"{CONTAINER_PORT}:8080",
        "-e", f"WORKER_URL=http://host.docker.internal:{STORE_PORT}",
        "-e", f"INGEST_TOKEN={TOKEN}",
        "-e", "GH_REPO=wuyilingwei/LRC",
        IMAGE,
    ], check=True, capture_output=True)

    failed = 0
    try:
        base = f"http://127.0.0.1:{CONTAINER_PORT}"
        for _ in range(60):
            try:
                if _get(f"{base}/health").get("ok"):
                    break
            except (urllib.error.URLError, ConnectionError):
                time.sleep(0.5)
        else:
            print("  ✗ 容器 /health 未就绪")
            return 1
        print("  ✓ 容器就绪 /health")

        started = _post(f"{base}/run", {"job_id": "diag-1", "kind": "diag", "params": {}})
        assert started["state"] == "running", started
        print("  ✓ /run 立刻返回作业号（不占请求等作业跑完）")

        visible = _get(f"{base}/status?job_id=diag-1")
        assert "stage" in visible and "progress" in visible and "message" in visible, visible
        print("  ✓ /status 返回阶段、进度与状态说明")

        again = _post(f"{base}/run", {"job_id": "diag-1", "kind": "diag", "params": {}})
        assert again["job_id"] == "diag-1", again
        print("  ✓ 同作业号重投幂等")

        bad = _post(f"{base}/run", {"job_id": "x", "kind": "不存在", "params": {}})
        assert bad.get("error") == "bad kind", bad
        print("  ✓ 拒绝未知作业类型")

        for _ in range(120):
            status = _get(f"{base}/status?job_id=diag-1")
            if status["state"] != "running":
                break
            time.sleep(0.5)
        assert status["state"] == "done", status
        result = status["result"]
        assert result["result"] == "ok", result
        print("  ✓ diag 作业完成，对象存储往返一致")

        for tool in ("python", "ffmpeg", "ffprobe", "git", "tesseract"):
            v = result["versions"][tool]
            assert not v.startswith("缺失"), f"{tool}: {v}"
            print(f"      {tool}: {v}")

        assert not _objects, f"探针对象应已清理，实剩 {list(_objects)}"
        print("  ✓ 探针对象已清理")

        missing = _get(f"{base}/status?job_id=no-such-job")
        assert missing.get("error") == "unknown job", missing
        print("  ✓ 未知作业号报 404")
    except AssertionError as e:
        failed += 1
        print(f"  ✗ {e}")
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        server.shutdown()

    print("容器冒烟：" + ("通过" if not failed else "失败"))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
