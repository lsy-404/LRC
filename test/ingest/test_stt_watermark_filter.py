#!/usr/bin/env python3
"""云端 STT 的已确认水印不应进入词流或歌词。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import review, stt  # noqa: E402


def test_removes_exact_zither_harp_watermark_and_repeated_run() -> None:
    words, _, _ = stt._parse_verbose_json_with_cleanup({
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


def test_removes_known_attribution_but_preserves_real_words_and_repetition() -> None:
    words, _, _ = stt._parse_verbose_json_with_cleanup({
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
            {"start": 16, "end": 17, "word": "编曲李宗盛作词：李宗盛"},
            {"start": 17, "end": 18, "word": "前奏作曲李宗盛尾句"},
            {"start": 18, "end": 19, "word": "李宗盛"},
            {"start": 19, "end": 20, "word": "演唱"},
            {"start": 20, "end": 21, "word": "作词"},
            {"start": 21, "end": 22, "word": "演唱李宗"},
            {"start": 22, "end": 23, "word": "la"},
            {"start": 23, "end": 24, "word": "la"},
            {"start": 24, "end": 25, "word": "la"},
        ],
    }, None)
    assert [word["text"] for word in words] == ["zither", "and", "harp", "前奏尾句", "李宗盛", "演唱", "作词", "演唱李宗", "la", "la", "la"]


def test_removes_character_split_watermarks_without_touching_long_lyrics() -> None:
    amara = "字幕由amaraorg社区提供"
    yoyo = "优优独播剧场yoyotelevisionseriesexclusive"
    attribution = "演唱李宗盛编曲李宗盛"
    words = [{"text": char} for char in amara + yoyo + attribution]
    assert stt.filter_watermark_words(words) == []
    long_lyric = "这是一句超过十二个字符的普通歌词不会被清理"
    assert stt.filter_watermark_words([{"text": char} for char in long_lyric]) == [{"text": char} for char in long_lyric]


def test_removes_only_repeated_silent_low_confidence_segments_and_records_reason() -> None:
    result = {
        "language": "chinese",
        "words": [
            {"start": 0, "end": 1, "word": "真实歌词"},
            {"start": 1, "end": 2, "word": "请勿转载"},
            {"start": 2, "end": 3, "word": "请勿转载"},
            {"start": 3, "end": 4, "word": "请勿转载"},
            {"start": 4, "end": 5, "word": "尾句"},
        ],
        "segments": [
            {"start": 0, "end": 1, "no_speech_prob": 0.1, "avg_logprob": -0.2, "compression_ratio": 1.1},
            {"start": 1, "end": 2, "no_speech_prob": 0.91, "avg_logprob": -1.2, "compression_ratio": 2.7},
            {"start": 2, "end": 3, "no_speech_prob": 0.92, "avg_logprob": -1.3, "compression_ratio": 2.8},
            {"start": 3, "end": 4, "no_speech_prob": 0.95, "avg_logprob": -1.1, "compression_ratio": 2.5},
            {"start": 4, "end": 5, "no_speech_prob": 0.1, "avg_logprob": -0.2, "compression_ratio": 1.1},
        ],
    }
    words, _, cleanup = stt._parse_verbose_json_with_cleanup(result, None)
    assert [word["text"] for word in words] == ["真实歌词", "尾句"]
    assert cleanup["reason"] == "highly_suspected_stt_pollution"
    assert cleanup["removed_word_count"] == 3


def test_preserves_normal_repeated_chorus_and_low_confidence_vocal_lyrics() -> None:
    result = {
        "language": "chinese",
        "words": [
            {"start": 0, "end": 1, "word": "我爱你"},
            {"start": 1, "end": 2, "word": "我爱你"},
            {"start": 2, "end": 3, "word": "我爱你"},
            {"start": 3, "end": 4, "word": "听见了吗"},
        ],
        "segments": [
            {"start": 0, "end": 1, "no_speech_prob": 0.03, "avg_logprob": -0.1, "compression_ratio": 1.0},
            {"start": 1, "end": 2, "no_speech_prob": 0.04, "avg_logprob": -0.2, "compression_ratio": 1.1},
            {"start": 2, "end": 3, "no_speech_prob": 0.02, "avg_logprob": -0.2, "compression_ratio": 1.0},
            {"start": 3, "end": 4, "no_speech_prob": 0.08, "avg_logprob": -1.4, "compression_ratio": 1.2},
        ],
    }
    words, _, cleanup = stt._parse_verbose_json_with_cleanup(result, None)
    assert [word["text"] for word in words] == ["我爱你", "我爱你", "我爱你", "听见了吗"]
    assert cleanup == {"removed_word_count": 0, "removed_segments": []}


def test_review_stt_payload_keeps_cleanup_audit() -> None:
    payload = review._split_stt({
        "audio_words": {"01.mp3": []},
        "audio_langs": {"01.mp3": "zh"},
        "stt_cleanup": {"01.mp3": {"reason": "highly_suspected_stt_pollution", "removed_word_count": 3}},
    })
    assert payload["01.mp3"]["cleanup"]["removed_word_count"] == 3


def run() -> int:
    test_removes_exact_zither_harp_watermark_and_repeated_run()
    test_removes_known_attribution_but_preserves_real_words_and_repetition()
    test_removes_character_split_watermarks_without_touching_long_lyrics()
    test_removes_only_repeated_silent_low_confidence_segments_and_records_reason()
    test_preserves_normal_repeated_chorus_and_low_confidence_vocal_lyrics()
    test_review_stt_payload_keeps_cleanup_audit()
    print("6/6 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
