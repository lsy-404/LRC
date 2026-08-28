"""Uploaded LRC is immutable; STT can only enrich its karaoke sidecar."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import authority_lrc, organize, pipeline, websearch  # noqa: E402


SOURCE = (
    "[ti:悸動（原詞）]\r\n"
    "[ar:原始歌手]\r\n"
    "[00:09.875]讓悸動變得簡單\r\n"
    "[00:03.125]第二句，不排序\r\n"
    "[00:12.500]词曲李宗盛\r\n"
)
WORDS = [{"start": 9.9, "end": 10.2, "text": "让"}, {"start": 10.2, "end": 10.8, "text": "悸动变得简单"}]


def test_lrc_is_classified_instead_of_discarded() -> None:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "01 原曲.lrc").write_bytes(SOURCE.encode("utf-8"))
        buckets = pipeline.classify(root)
        assert [path.name for path in buckets["lrc"]] == ["01 原曲.lrc"]
        assert not buckets["other"]


def test_authoritative_lrc_survives_draft_finalize_and_stt_enrichment() -> None:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        source = root / "01 原曲.lrc"
        source.write_bytes(SOURCE.encode("utf-8"))
        track = authority_lrc.load_authoritative_track(source, 1)
        track["file"] = "01 原曲.mp3"
        prior_available = websearch.available
        websearch.available = lambda: False
        try:
            draft = organize.build_draft(
                tracks_explicit=[track], booklet_text="", credits_text="", manifest={"album": "测试"},
                audio_words={"01 原曲.mp3": WORDS}, audio_langs={"01 原曲.mp3": "yue"},
            )
        finally:
            websearch.available = prior_available

        result = draft["tracks"][0]
        assert result["authoritative_lrc"] is True
        assert result["timing_locked"] is True
        assert result["lrc"] == SOURCE
        assert "讓悸動變得簡單" in result["lrc"]
        assert "让悸动变得简单" not in result["lrc"]
        assert "词曲李宗盛" in result["lrc"]
        assert result["lrc"].index("[00:09.875]") < result["lrc"].index("[00:03.125]")
        assert result["klrc"] is not None
        assert "[00:09.875]" in result["klrc"]
        assert "[00:03.125]" in result["klrc"]
        assert "<00:09." in result["klrc"]

        output = root / "res"
        organize.finalize(draft, output)
        written = next(output.glob("测试/*.lrc"))
        assert written.read_bytes() == SOURCE.encode("utf-8")


def run() -> int:
    test_lrc_is_classified_instead_of_discarded()
    test_authoritative_lrc_survives_draft_finalize_and_stt_enrichment()
    print("2/2 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
