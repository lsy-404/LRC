from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

from ingest.pipeline import apply_uploaded_audio_metadata  # noqa: E402


class UploadedAudioMetadataTests(unittest.TestCase):
    def test_compressed_audio_metadata_restores_track_and_album_fields(self) -> None:
        tracks = [{"file": "01.webm", "title": "猜测", "order": 9}]
        manifest = {}
        apply_uploaded_audio_metadata(tracks, {
            "tracks": [{"path": "专辑/01.webm", "metadata": {
                "title": "原始曲名", "trackNumber": 1, "artist": "演唱者",
                "album": "原始专辑", "date": "2026-08-28",
            }}],
        }, {"01.webm": "专辑/01.webm"}, manifest)
        self.assertEqual(tracks[0]["title"], "原始曲名")
        self.assertEqual(tracks[0]["order"], 1)
        self.assertEqual(manifest["vocal"], ["演唱者"])
        self.assertEqual(manifest["album"], "原始专辑")
        self.assertEqual(manifest["year"], "2026-08-28")


if __name__ == "__main__":
    unittest.main()
