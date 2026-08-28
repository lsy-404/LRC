#!/usr/bin/env python3
"""runner 命令失败信息：保留可诊断尾部，绝不回传令牌。"""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "runner"))
import jobs  # noqa: E402


class JobFailureDetailTest(unittest.TestCase):
    def _failed(self, *, stdout="", stderr=""):
        return subprocess.CompletedProcess(["tool"], 1, stdout=stdout, stderr=stderr)

    def test_failure_detail_redacts_command_and_output(self):
        secret = "private-token"
        logs = []
        with patch.object(jobs.subprocess, "run", return_value=self._failed(
            stderr=f"unable to authenticate {secret}\nactual cause")):
            with self.assertRaises(RuntimeError) as caught:
                jobs.run(["tool", secret], logs.append, redact=secret)
        message = str(caught.exception)
        self.assertIn("命令失败(1): tool ***", message)
        self.assertIn("[stderr] unable to authenticate ***", message)
        self.assertIn("[stderr] actual cause", message)
        self.assertNotIn(secret, message)
        self.assertNotIn(secret, "\n".join(logs))

    def test_failure_detail_includes_stdout_and_is_bounded(self):
        lines = [f"line-{i:03d}" + ("x" * 120) for i in range(40)]
        with patch.object(jobs.subprocess, "run", return_value=self._failed(stdout="\n".join(lines))):
            with self.assertRaises(RuntimeError) as caught:
                jobs.run(["tool"], lambda _line: None)
        message = str(caught.exception)
        detail = message.split("\n", 1)[1]
        self.assertIn("[stdout] line-039", detail)
        self.assertNotIn("line-000", detail)
        self.assertLessEqual(len(detail), jobs.FAILURE_OUTPUT_CHARS)


if __name__ == "__main__":
    unittest.main()
