#!/usr/bin/env python3
"""容器入口：收编排 Worker 派来的作业，后台线程执行，Worker 轮询状态取结果。

作业动辄数分钟，不能占着一条请求等——/run 立刻返回作业号，/status 查进度。
容器不对公网开放，只能经 Worker 的容器绑定进来，故此处不再单设鉴权。
"""
from __future__ import annotations

import json
import threading
import traceback
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import jobs

PORT = 8080
MAX_LOG = 400

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _update(job_id: str, **fields) -> None:
    fields.setdefault("updated_at", _now())
    with _lock:
        _jobs.setdefault(job_id, {}).update(fields)


def _log(job_id: str):
    def emit(line: str):
        with _lock:
            buf = _jobs.setdefault(job_id, {}).setdefault("log", [])
            buf.append(str(line))
            del buf[:-MAX_LOG]
        print(f"[{job_id}] {line}", flush=True)
    return emit


def _progress(job_id: str, stage: str, value: int | None, message: str) -> None:
    _update(job_id, stage=stage, progress=value, message=message)


def _execute(job_id: str, kind: str, params: dict) -> None:
    log = _log(job_id)
    try:
        handler = jobs.HANDLERS[kind]
        result = handler(
            params, log,
            lambda stage, value, message: _progress(job_id, stage, value, message),
        )
        _update(job_id, state="done", result=result, stage="done", progress=100,
                message="作业完成")
        log(f"作业完成：{result.get('result')}")
    except Exception as exc:
        log(f"作业失败：{exc}")
        log(traceback.format_exc()[-2000:])
        _update(job_id, state="error", error=str(exc), stage="error", progress=None,
                message=str(exc))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 默认实现往 stderr 打访问日志，噪音大
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, {"ok": True})
        if url.path == "/status":
            job_id = (parse_qs(url.query).get("job_id") or [""])[0]
            with _lock:
                job = dict(_jobs.get(job_id) or {})
            if not job:
                return self._send(404, {"error": "unknown job"})
            return self._send(200, job)
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/run":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except ValueError:
            return self._send(400, {"error": "bad json"})

        kind = body.get("kind")
        if kind not in jobs.HANDLERS:
            return self._send(400, {"error": "bad kind"})

        job_id = str(body.get("job_id") or uuid.uuid4().hex)
        with _lock:
            existing = _jobs.get(job_id)
        if existing:  # 幂等：Worker 重试同一作业号时不重复跑
            return self._send(202, {"job_id": job_id, "state": existing.get("state")})

        _update(job_id, state="running", log=[], result=None, error=None,
                stage="queued", progress=1, message="作业已接收")
        threading.Thread(target=_execute, args=(job_id, kind, body.get("params") or {}),
                         daemon=True).start()
        return self._send(202, {"job_id": job_id, "state": "running"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
