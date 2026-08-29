from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import organize, pipeline, review, websearch  # noqa: E402


def _track(title: str = "本次曲目") -> dict:
    return {
        "order": 1,
        "title": title,
        "lrc": "[00:01.000]本次歌词\n",
        "klrc": "[00:01.000]<00:01.000>本<00:01.100>次<00:01.200>歌<00:01.300>词\n",
        "timing_locked": True,
        "aligned": True,
    }


def _draft(*, submission_type: str = "", cover_path: str | None = None) -> dict:
    return {
        "album": "任意名称",
        "submission_type": submission_type,
        "meta": {"vocal": ["新声库"]},
        "names": {"zh_name": "任意名称", "en_name": ""},
        "tracks": [_track()],
        "cover_path": cover_path,
    }


def test_phase_a_b_preserves_single_type_and_only_updates_current_lyrics() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / "res" / "单曲"
        target.mkdir(parents=True)
        old_meta = '中文名 = "既有单曲"\n'
        target.joinpath("meta.toml").write_text(old_meta, encoding="utf-8")
        target.joinpath("cover.png").write_bytes(b"existing-cover")
        target.joinpath("9 已有曲目.lrc").write_text("[00:01.000]保留\n", encoding="utf-8")

        uploaded_cover = root / "uploaded.png"
        uploaded_cover.write_bytes(b"new-cover")
        bundle = root / "bundle"
        review.write_bundle(
            bundle,
            _draft(submission_type="single", cover_path=str(uploaded_cover)),
            extra={"submission_type": "single"},
        )

        restored = review.read_bundle(bundle)
        assert restored["submission_type"] == "single"

        result = pipeline.run_phase_b(bundle, root / "res")
        assert result["result"] == "ok"
        assert result["albums"][0]["submission_type"] == "single"
        assert (target / "1 本次曲目.lrc").is_file()
        assert (target / "1 本次曲目.klrc").is_file()
        assert target.joinpath("9 已有曲目.lrc").read_text(encoding="utf-8") == "[00:01.000]保留\n"
        assert target.joinpath("meta.toml").read_text(encoding="utf-8") == old_meta
        assert target.joinpath("cover.png").read_bytes() == b"existing-cover"
        assert not (root / "res" / "任意名称").exists()


def test_phase_a_marks_single_submission_for_phase_b() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source"
        source.mkdir()
        source.joinpath("manifest.toml").write_text(
            'album = "单曲"\nsubmission_type = "single"\n', encoding="utf-8"
        )
        source.joinpath("01 新曲.lrc").write_text("[00:01.000]歌词\n", encoding="utf-8")
        (root / "res" / "单曲").mkdir(parents=True)

        original_available = websearch.available
        original_read_toml = pipeline.org_mod._read_toml
        websearch.available = lambda: False
        pipeline.org_mod._read_toml = lambda _: {"album": "单曲", "submission_type": "single"}
        try:
            result = pipeline.run_phase_a(
                source, root / "res", root / "work", "", root / "bundles", timestamp="now"
            )
        finally:
            websearch.available = original_available
            pipeline.org_mod._read_toml = original_read_toml

        bundle = Path(result["bundles"][0])
        assert result["albums"][0]["submission_type"] == "single"
        assert review.read_status(bundle)["submission_type"] == "single"
        assert review.read_bundle(bundle)["submission_type"] == "single"


def test_single_submission_without_existing_target_is_skipped_safely() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        bundle = root / "bundle"
        review.write_bundle(
            bundle,
            _draft(submission_type="single"),
            extra={"submission_type": "single"},
        )

        result = pipeline.run_phase_b(bundle, root / "res")
        assert result["result"] == "empty"
        assert result["albums"][0]["result"] == "missing_single_directory"
        assert not (root / "res" / "单曲").exists()


def test_regular_album_still_writes_metadata_and_cover() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        cover = root / "cover.png"
        cover.write_bytes(b"regular-cover")
        result = organize.finalize(_draft(cover_path=str(cover)), root / "res")

        album = root / "res" / "任意名称"
        assert result["result"] == "ok"
        assert (album / "1 本次曲目.lrc").is_file()
        assert (album / "meta.toml").is_file()
        assert (album / "cover.png").read_bytes() == b"regular-cover"


if __name__ == "__main__":
    test_phase_a_b_preserves_single_type_and_only_updates_current_lyrics()
    test_phase_a_marks_single_submission_for_phase_b()
    test_single_submission_without_existing_target_is_skipped_safely()
    test_regular_album_still_writes_metadata_and_cover()
    print("4/4 通过")
