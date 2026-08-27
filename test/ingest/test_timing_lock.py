#!/usr/bin/env python3
"""手工逐字时间轴在 Phase B 中必须保持不重对齐。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import organize  # noqa: E402


def test_manual_timing_lock_bypasses_realign() -> None:
    locked = {"timing_locked": True, "edited": True, "lrc": "[00:01.000]校正\n"}
    incomplete = {"timing_locked": True, "edited": True, "lrc": ""}
    assert organize.track_needs_align(locked) is False
    assert organize.track_needs_align(incomplete) is True


def run() -> int:
    test_manual_timing_lock_bypasses_realign()
    print("1/1 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
