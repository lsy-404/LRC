#!/usr/bin/env python3
"""lite 容器的并发和音频边界回归。"""
from __future__ import annotations

import ast
import json
import re
import sys
import threading
import time
import unittest
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


class ContainerMemoryGuardTest(unittest.TestCase):
    def test_phase_a_keeps_only_ocr_in_container(self) -> None:
        self.assertEqual(_executor_worker_counts(ROOT / ".github/scripts/ingest/ocr.py"), [1])
        self.assertEqual(_executor_worker_counts(ROOT / ".github/scripts/ingest/pipeline.py"), [])

    def test_container_uses_lite_instance(self) -> None:
        text = (ROOT / "worker/wrangler.jsonc").read_text(encoding="utf-8")
        config = json.loads(re.sub(r"^\s*//.*$", "", text, flags=re.MULTILINE))
        container = config["containers"][0]
        self.assertEqual(container["instance_type"], "lite")
        self.assertEqual(container["max_instances"], 5)

    def test_runner_never_executes_two_jobs_at_once(self) -> None:
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
            threads = [
                threading.Thread(target=server._execute,
                                 args=(f"guard-{i}", "memory_guard", {}))
                for i in range(2)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(peak, 1)
        finally:
            if original is None:
                jobs.HANDLERS.pop("memory_guard", None)
            else:
                jobs.HANDLERS["memory_guard"] = original


if __name__ == "__main__":
    unittest.main()
