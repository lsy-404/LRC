#!/usr/bin/env python3
"""云端 STT 的已确认水印不应进入词流或歌词。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import stt  # noqa: E402


def test_removes_exact_zither_harp_watermark_and_repeated_run() -> None:
    words, _ = stt._parse_verbose_json({
        "language": "english",
        "words": [
            {"start": 0, "end": 1, "word": "real"},
            {"start": 1, "end": 2, "word": "Zither"},
            {"start": 2, "end": 3, "word": "Harp"},
            {"start": 3, "end": 4, "word": "ZitherHarp"},
            {"start": 4, "end": 5, "word": "lyrics"},
        ],
        "segments": [{"end": 4}],
    }, None)
    assert [word["text"] for word in words] == ["real", "lyrics"]
    assert words[0].get("seg_end") is True


def test_removes_known_subtitle_attribution_but_preserves_real_words_and_repetition() -> None:
    words, _ = stt._parse_verbose_json({
        "language": "english",
        "words": [
            {"start": 0, "end": 1, "word": "zither"},
            {"start": 1, "end": 2, "word": "and"},
            {"start": 2, "end": 3, "word": "harp"},
            {"start": 3, "end": 4, "word": "字幕由"},
            {"start": 4, "end": 5, "word": "Amara.org"},
            {"start": 5, "end": 6, "word": "社区提供"},
            {"start": 6, "end": 7, "word": "由"},
            {"start": 7, "end": 8, "word": "Amaraorg"},
            {"start": 8, "end": 9, "word": "社群"},
            {"start": 9, "end": 10, "word": "提供的字幕"},
            {"start": 10, "end": 11, "word": "优优独播剧场"},
            {"start": 11, "end": 12, "word": "YoYoTelevisionSeriesExclusive"},
            {"start": 12, "end": 13, "word": "词曲"},
            {"start": 13, "end": 14, "word": "李宗盛"},
            {"start": 14, "end": 15, "word": "演唱"},
            {"start": 15, "end": 16, "word": "李宗盛"},
            {"start": 16, "end": 17, "word": "la"},
            {"start": 17, "end": 18, "word": "la"},
            {"start": 18, "end": 19, "word": "la"},
        ],
    }, None)
    assert [word["text"] for word in words] == ["zither", "and", "harp", "la", "la", "la"]


def run() -> int:
    test_removes_exact_zither_harp_watermark_and_repeated_run()
    test_removes_known_subtitle_attribution_but_preserves_real_words_and_repetition()
    print("2/2 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
