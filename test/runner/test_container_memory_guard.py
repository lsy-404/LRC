#!/usr/bin/env python3
"""基础规格容器的并发内存护栏回归。"""
from __future__ import annotations

import ast
import json
import re
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "runner"))


def _executor_worker_counts(path: Path) -> list[int]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    counts = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            continue
        if node.func.id != "ThreadPoolExecutor":
            continue
        value = next(keyword.value for keyword in node.keywords if keyword.arg == "max_workers")
        counts.append(ast.literal_eval(value))
    return counts


def test_phase_a_heavy_stages_are_single_lane() -> None:
    assert _executor_worker_counts(ROOT / ".github/scripts/ingest/ocr.py") == [1]
    assert _executor_worker_counts(ROOT / ".github/scripts/ingest/pipeline.py") == [1]


def test_container_uses_basic_instance() -> None:
    # wrangler.jsonc currently only uses comments that JSON parsers can strip safely.
    text = (ROOT / "worker/wrangler.jsonc").read_text(encoding="utf-8")
    config = json.loads(re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE))
    container = config["containers"][0]
    assert container["instance_type"] == "basic"
    assert container["max_instances"] == 5


def test_runner_never_executes_two_jobs_at_once() -> None:
    import jobs
    import server

    active = 0
    peak = 0
    lock = threading.Lock()

    def handler(_params, _log, _report):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.03)
        with lock:
            active -= 1
        return {"result": "ok"}

    original = jobs.HANDLERS.get("memory_guard")
    jobs.HANDLERS["memory_guard"] = handler
    try:
        threads = [threading.Thread(target=server._execute, args=(f"guard-{i}", "memory_guard", {}))
                   for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert peak == 1
    finally:
        if original is None:
            jobs.HANDLERS.pop("memory_guard", None)
        else:
            jobs.HANDLERS["memory_guard"] = original
