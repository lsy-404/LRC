from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))
from ingest import organize  # noqa: E402


def _track(order: int, title: str, **extra: object) -> dict:
    return {
        "order": order,
        "title": title,
        "lines": ["歌词"],
        "lrc": "[00:01.000]歌词\n",
        "klrc": "[00:01.000]<00:01.000>歌<00:01.100>词\n",
        "timing_locked": True,
        "aligned": True,
        **extra,
    }


def test_finalize_uses_requested_basenames_without_duplicate_suffixes() -> None:
    root = Path(tempfile.mkdtemp())
    draft = {
        "album": "测试专辑",
        "meta": {},
        "names": {},
        "tracks": [
            _track(1, "普通", output_name="普通输出.klrc"),
            _track(2, "伴奏", inst=True, output_name="通用输出", final_name="最终输出.lrc"),
            _track(3, "回退"),
        ],
    }
    organize.finalize(draft, res_dir=root)
    album = root / "测试专辑"
    assert (album / "普通输出.lrc").is_file()
    assert (album / "普通输出.klrc").is_file()
    assert (album / "最终输出.lrc").is_file()
    assert (album / "最终输出.klrc").is_file()
    assert (album / "3 回退.lrc").is_file()


def test_output_basename_discards_path_components() -> None:
    assert organize._output_basename(_track(1, "歌", output_name="../../不会越界.lrc"), 1) == "不会越界"
    assert organize._output_basename(_track(2, "歌", inst=True, output_name="通用", final_name=""), 2) == "通用"
