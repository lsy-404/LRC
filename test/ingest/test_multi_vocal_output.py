#!/usr/bin/env python3
"""Phase B 必须把已定时附加声部写入最终 LRC/KLRC。"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import organize  # noqa: E402


MAIN_LRC = "[ti:主声部]\n[ar:歌手]\n\n[00:02.000]主唱后句\n[00:01.000]主唱先句\n"
MAIN_KLRC = "[ti:主声部]\n[ar:歌手]\n\n[00:02.000]<00:02.000>后\n[00:01.000]<00:01.000>先\n"


def test_single_vocal_output_is_byte_identical() -> None:
    assert organize.merge_vocal_outputs(MAIN_LRC, MAIN_KLRC, []) == (MAIN_LRC, MAIN_KLRC)


def test_final_output_merges_timed_vocals_without_vocal_names() -> None:
    vocals = [{
        "name": "和声", "timing_locked": True,
        "lrc": "[ti:和声]\n[00:01.000]和声同拍\n[00:01.500]和声后句\n",
        "klrc": "[ti:和声]\n[00:01.000]<00:01.000>和<00:01.200>声<00:01.400>同<00:01.600>拍\n[00:01.500]<00:01.500>后\n",
    }]
    lrc, klrc = organize.merge_vocal_outputs(MAIN_LRC, MAIN_KLRC, vocals)
    assert lrc.startswith("[ti:主声部]\n[ar:歌手]\n\n"), lrc
    assert "[ti:和声]" not in lrc and "和声：" not in lrc, lrc
    assert [line for line in lrc.splitlines() if line.startswith("[")] == [
        "[ti:主声部]", "[ar:歌手]", "[00:01.000]主唱先句", "[00:01.000]和声同拍",
        "[00:01.500]和声后句", "[00:02.000]主唱后句",
    ]
    assert klrc is not None and "[ti:和声]" not in klrc
    assert "[00:01.000]<00:01.000>先" in klrc and "[00:01.000]<00:01.000>和" in klrc


def test_phase_b_ignores_empty_or_untimed_vocals() -> None:
    vocals = [
        {"timing_locked": False, "lrc": "[00:01.000]未锁定\n", "klrc": "[00:01.000]<00:01.000>未锁定\n"},
        {"timing_locked": True, "lrc": "没有时间\n", "klrc": "没有时间\n"},
        {"timing_locked": True, "lrc": "", "klrc": ""},
    ]
    with tempfile.TemporaryDirectory() as tmp:
        output = organize.finalize({
            "album": "测试", "meta": {}, "names": {}, "audio_words": {}, "tracks": [{
                "order": 1, "title": "歌曲", "lrc": MAIN_LRC, "klrc": MAIN_KLRC,
                "coverage": 1, "aligned": True, "vocals": vocals,
            }],
        }, Path(tmp))
        assert output["track_count"] == 1
        assert (Path(tmp) / "测试" / "1 歌曲.lrc").read_text(encoding="utf-8") == MAIN_LRC
        assert (Path(tmp) / "测试" / "1 歌曲.klrc").read_text(encoding="utf-8") == MAIN_KLRC


def test_same_timestamp_keeps_main_before_each_harmony_and_ignores_empty_part() -> None:
    lrc, klrc = organize.merge_vocal_outputs(
        "[00:01.000]主唱\n",
        "[00:01.000]<00:01.120>主<00:01.300>唱\n",
        [
            {"timing_locked": True, "lrc": "[00:01.000]和声甲\n", "klrc": "[00:01.000]<00:01.180>和<00:01.360>甲\n"},
            {"timing_locked": True, "lrc": "\n", "klrc": "\n"},
            {"timing_locked": True, "lrc": "[00:01.000]和声乙\n", "klrc": "[00:01.000]<00:01.220>和<00:01.410>乙\n"},
        ],
    )
    assert lrc.splitlines() == ["[00:01.000]主唱", "[00:01.000]和声甲", "[00:01.000]和声乙"]
    assert klrc is not None and klrc.splitlines() == [
        "[00:01.000]<00:01.120>主<00:01.300>唱",
        "[00:01.000]<00:01.180>和<00:01.360>甲",
        "[00:01.000]<00:01.220>和<00:01.410>乙",
    ]


def run() -> int:
    test_single_vocal_output_is_byte_identical()
    test_final_output_merges_timed_vocals_without_vocal_names()
    test_phase_b_ignores_empty_or_untimed_vocals()
    test_same_timestamp_keeps_main_before_each_harmony_and_ignores_empty_part()
    print("4/4 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
