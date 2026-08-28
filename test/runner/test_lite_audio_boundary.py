from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class LiteAudioBoundaryTests(unittest.TestCase):
    def test_phase_a_does_not_download_audio_objects(self):
        source = (ROOT / "runner" / "jobs.py").read_text(encoding="utf-8")
        self.assertIn('if str(f.get("mime") or "").startswith("audio/"):', source)
        self.assertIn('audio_files.append(f)', source)
        self.assertIn('else:\n                total += store.download', source)

    def test_pipeline_consumes_worker_stt_without_local_recognition(self):
        source = (ROOT / ".github" / "scripts" / "ingest" / "pipeline.py").read_text(encoding="utf-8")
        self.assertIn('load_precomputed_stt', source)
        self.assertNotIn('stt_mod.transcribe_words', source)


if __name__ == "__main__":
    unittest.main()
