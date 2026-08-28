#!/usr/bin/env python3
"""音频 tag 读取必须以文件内容为准，而不是不可靠的扩展名。"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))
from ingest import pipeline  # noqa: E402


class AudioContentRoutingTest(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp())
        self.disguised = self.work / "source.mp3"
        streaminfo = (
            (4096).to_bytes(2, "big") * 2 + b"\0" * 6
            + ((44100 << 44) | (1 << 41) | (15 << 36)).to_bytes(8, "big")
            + b"\0" * 16
        )
        self.disguised.write_bytes(b"fLaC\x80\x00\x00\x22" + streaminfo)

    def test_minimal_flac_renamed_mp3_loads_without_mp3_parser(self):
        from mutagen.flac import FLAC
        parsed = pipeline.read_audio_tags(self.disguised)
        self.assertIsInstance(parsed, FLAC)

    def test_flac_header_overrides_mp3_extension_for_meta_and_cover(self):
        image = b"\x89PNG\r\n\x1a\ncover"
        audio = SimpleNamespace(
            tags={"date": ["2026-08-28"], "comments": ["official source"]},
            pictures=[SimpleNamespace(data=image)],
        )
        with patch("mutagen.flac.FLAC", return_value=audio) as flac, \
             patch("mutagen.File", side_effect=AssertionError("must not parse as MP3")):
            meta, hint = pipeline.extract_audio_meta([self.disguised])
            cover = pipeline.extract_embedded_cover([self.disguised], self.work)
        self.assertEqual(meta, {"year": "2026-08-28"})
        self.assertEqual(hint, "official source")
        self.assertEqual(cover.read_bytes(), image)
        self.assertEqual(flac.call_count, 2)

    def test_normal_header_keeps_generic_mutagen_path(self):
        ordinary = self.work / "ordinary.mp3"
        ordinary.write_bytes(b"ID3\x04\x00\x00")
        audio = SimpleNamespace(tags={"date": ["2020"]}, pictures=[])
        with patch("mutagen.File", return_value=audio) as generic, \
             patch("mutagen.flac.FLAC", side_effect=AssertionError("unexpected FLAC parser")):
            meta, _ = pipeline.extract_audio_meta([ordinary])
        self.assertEqual(meta, {"year": "2020"})
        generic.assert_called_once_with(str(ordinary))

    def test_bad_tag_is_skipped_without_aborting_metadata_or_cover_scan(self):
        broken = self.work / "broken.mp3"
        broken.write_bytes(b"fLaCbroken")
        good = self.work / "good.mp3"
        good.write_bytes(b"ID3\x04\x00\x00")
        good_audio = SimpleNamespace(tags={"date": ["2022"]}, pictures=[])
        with patch("mutagen.flac.FLAC", side_effect=ValueError("invalid flac")), \
             patch("mutagen.File", return_value=good_audio):
            meta, _ = pipeline.extract_audio_meta([broken, good])
            cover = pipeline.extract_embedded_cover([broken, good], self.work)
        self.assertEqual(meta, {"year": "2022"})
        self.assertIsNone(cover)


if __name__ == "__main__":
    unittest.main()
