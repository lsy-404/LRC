#!/usr/bin/env python3
"""中文变体 STT 在对齐前和最终歌词都应按简体规范输出。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import lyrics, organize  # noqa: E402


def test_chinese_variants_include_cantonese_but_not_japanese() -> None:
    assert lyrics.is_chinese_language("zh")
    assert lyrics.is_chinese_language("zh-Hant")
    assert lyrics.is_chinese_language("yue")
    assert lyrics.is_chinese_language("cmn")
    assert not lyrics.is_chinese_language("ja")
    assert lyrics.to_simplified("讓悸動變得簡單") == "让悸动变得简单"


def test_cantonese_track_normalizes_final_lrc_and_klrc() -> None:
    track = {"title": "悸動", "file": "a.mp3", "lines": ["讓悸動變得簡單"]}
    words = {"a.mp3": [
        {"start": 0, "end": 1, "text": "讓"}, {"start": 1, "end": 2, "text": "悸動"},
        {"start": 2, "end": 3, "text": "變得"}, {"start": 3, "end": 4, "text": "簡單"},
    ]}
    lrc, _, klrc = organize.build_track_lrc(track, "专辑", words, set(), {"a.mp3": "yue"})
    assert "让悸动变得简单" in lrc
    assert "讓" not in lrc
    assert klrc is not None and "讓" not in klrc


def run() -> int:
    test_chinese_variants_include_cantonese_but_not_japanese()
    test_cantonese_track_normalizes_final_lrc_and_klrc()
    print("2/2 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
