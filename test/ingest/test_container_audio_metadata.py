from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

from ingest import pipeline


class _Tags(dict):
    def __init__(self):
        super().__init__({"title": ["原始曲名"], "tracknumber": ["2/10"], "artist": ["演唱者"], "album": ["原始专辑"], "date": ["2024"], "comments": ["label note"]})
        self.tags = self
        self.pictures = [type("Picture", (), {"data": b"\x89PNG\r\n\x1a\ncover"})()]


class ContainerAudioMetadataTests(unittest.TestCase):
    def test_container_extracts_original_tag_metadata_and_embedded_cover(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "track.flac"
            audio.write_bytes(b"fLaC")
            work = Path(directory) / "work"
            work.mkdir()
            with mock.patch.object(pipeline, "read_audio_tags", return_value=_Tags()):
                metadata, hint = pipeline.extract_audio_meta([audio])
                cover = pipeline.extract_embedded_cover([audio], work)
                tracks = [{"file": "track.flac", "title": "猜测", "order": 9}]
                manifest = {}
                pipeline.apply_audio_tag_metadata(tracks, [audio], manifest)
            self.assertEqual(metadata, {"year": "2024"})
            self.assertEqual(hint, "label note")
            self.assertEqual(cover.read_bytes(), b"\x89PNG\r\n\x1a\ncover")
            self.assertEqual(tracks[0], {"file": "track.flac", "title": "原始曲名", "order": 2})
            self.assertEqual(manifest, {"vocal": ["演唱者"], "album": "原始专辑", "year": "2024"})

    def test_explicit_manifest_album_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "track.flac"
            audio.write_bytes(b"fLaC")
            with mock.patch.object(pipeline, "read_audio_tags", return_value=_Tags()):
                manifest = {"album": "投稿专辑"}
                pipeline.apply_audio_tag_metadata([{"file": "track.flac"}], [audio], manifest)
            self.assertEqual(manifest["album"], "投稿专辑")


if __name__ == "__main__":
    unittest.main()
