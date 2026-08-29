from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

from ingest import pipeline  # noqa: E402


class UploadedManifestMetadataTests(unittest.TestCase):
    def test_phase_a_skips_removed_audio_tags_with_empty_metadata_pair(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp = Path(tmp_dir)
            src = tmp / "payload"
            src.mkdir()
            (src / "upload-manifest.json").write_text(json.dumps({
                "upload_metadata": {"album": "TEST", "tracks": []},
            }), encoding="utf-8")

            original = pipeline.extract_audio_meta
            pipeline.extract_audio_meta = lambda _audios: self.fail(
                "compressed uploads must not re-read removed source tags"
            )
            try:
                summary = pipeline._process_album(
                    "TEST", src, tmp / "res", tmp / "work", False,
                    mode="phase_a", bundle_root=tmp / "bundle", precomputed_stt={},
                )
            finally:
                pipeline.extract_audio_meta = original

        self.assertEqual(summary["result"], "empty")


if __name__ == "__main__":
    unittest.main()
