"""Saved lyric-maker metadata must be reflected in generated LRC headers."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import organize  # noqa: E402


def _track(*, authoritative: bool = False) -> dict:
    return {
        "order": 1 if not authoritative else 2,
        "title": "自动填充" if not authoritative else "权威原文",
        "lrc": "[ti:曲名]\n[al:专辑]\n[ar:歌手]\n[by:旧署名]\n\n[00:01.000]歌词\n",
        "klrc": "[ti:曲名]\n[al:专辑]\n[ar:歌手]\n[by:旧署名]\n\n[00:01.000]<00:01.000>歌<00:01.100>词\n",
        "timing_locked": True,
        "aligned": True,
        "authoritative_lrc": authoritative,
    }


def _draft(lyric_maker: list[str]) -> dict:
    return {
        "album": "测试专辑",
        "meta": {"lyric_maker": lyric_maker},
        "names": {"zh_name": "测试专辑", "en_name": ""},
        "tracks": [_track(), _track(authoritative=True)],
    }


def test_finalize_syncs_saved_lyric_maker_to_non_authoritative_lrc_and_klrc() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        organize.finalize(_draft(["甲", "乙"]), root)
        album = root / "测试专辑"
        lrc = album.joinpath("1 自动填充.lrc").read_text(encoding="utf-8")
        klrc = album.joinpath("1 自动填充.elrc").read_text(encoding="utf-8")
        authoritative = album.joinpath("2 权威原文.lrc").read_text(encoding="utf-8")
        for output in (lrc, klrc):
            assert output.startswith("[ti:曲名]\n[al:专辑]\n[ar:歌手]\n[by:甲/乙]\n\n")
            assert "[00:01.000]" in output
        assert "[by:旧署名]" in authoritative


def test_finalize_fills_an_empty_by_value_when_no_lyric_maker_is_saved() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        organize.finalize(_draft([]), root)
        lrc = root.joinpath("测试专辑/1 自动填充.lrc").read_text(encoding="utf-8")
        assert "[by:]" in lrc
        assert "[by:旧署名]" not in lrc


if __name__ == "__main__":
    test_finalize_syncs_saved_lyric_maker_to_non_authoritative_lrc_and_klrc()
    test_finalize_fills_an_empty_by_value_when_no_lyric_maker_is_saved()
    print("2/2 通过")
