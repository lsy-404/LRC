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
        super().__init__({"date": ["2024"], "comments": ["label note"]})
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
            self.assertEqual(metadata, {"year": "2024"})
            self.assertEqual(hint, "label note")
            self.assertEqual(cover.read_bytes(), b"\x89PNG\r\n\x1a\ncover")


if __name__ == "__main__":
    unittest.main()
