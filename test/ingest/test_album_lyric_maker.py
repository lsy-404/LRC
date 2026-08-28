"""Album timing credits are metadata-only and never modify authoritative LRC."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import authority_lrc, organize, websearch  # noqa: E402


SOURCE = "[00:01.000]原始歌词\n"


def test_timing_credits_are_deduplicated_and_required_credit_is_appended() -> None:
    assert organize.ensure_lyric_maker({"lyric_maker": ["甲", "乙", "甲"]})["lyric_maker"] == ["甲", "乙", "武乙凌薇"]
    assert organize.ensure_lyric_maker({"lyric_maker": ["甲", "武乙凌薇", "甲", "乙"]})["lyric_maker"] == ["甲", "武乙凌薇", "乙"]


def test_manifest_timing_credit_only_enriches_meta_for_authoritative_lrc() -> None:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        source = root / "01 原曲.lrc"
        source.write_bytes(SOURCE.encode("utf-8"))
        track = authority_lrc.load_authoritative_track(source, 1)
        prior_available = websearch.available
        websearch.available = lambda: False
        try:
            draft = organize.build_draft(
                tracks_explicit=[track], booklet_text="", credits_text="",
                manifest={"album": "测试", "lyric_maker": ["甲", "武乙凌薇", "甲", "乙"]},
                audio_words={},
            )
        finally:
            websearch.available = prior_available
        assert draft["meta"]["lyric_maker"] == ["甲", "武乙凌薇", "乙"]
        assert draft["tracks"][0]["lrc"] == SOURCE


if __name__ == "__main__":
    test_timing_credits_are_deduplicated_and_required_credit_is_appended()
    test_manifest_timing_credit_only_enriches_meta_for_authoritative_lrc()
    print("2/2 通过")
