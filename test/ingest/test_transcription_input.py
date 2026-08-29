from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".github" / "scripts"))

from ingest import stt


class TranscriptionInputTests(unittest.TestCase):
    def test_supported_small_file_is_sent_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "track.webm"
            audio.write_bytes(b"original")
            with mock.patch.object(stt, "_compress_for_upload") as compress:
                data, name = stt._audio_for_transcription(audio)
            self.assertEqual((data, name), (b"original", "track.webm"))
            compress.assert_not_called()

    def test_flac_and_oversize_files_use_container_ffmpeg(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "track.flac"
            audio.write_bytes(b"original")
            with mock.patch.object(stt, "_compress_for_upload", return_value=(b"mp3", "track.mp3")) as compress:
                self.assertEqual(stt._audio_for_transcription(audio), (b"mp3", "track.mp3"))
            compress.assert_called_once_with(audio)

            compatible = Path(directory) / "track.mp3"
            compatible.write_bytes(b"xx")
            with mock.patch.object(stt, "OPENAI_MAX_BYTES", 1), \
                    mock.patch.object(stt, "_compress_for_upload", return_value=(b"x", "track.mp3")) as compress:
                self.assertEqual(stt._audio_for_transcription(compatible), (b"x", "track.mp3"))
            compress.assert_called_once_with(compatible)

    def test_flac_header_overrides_compatible_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "masked.mp3"
            audio.write_bytes(b"fLaCpayload")
            with mock.patch.object(stt, "_compress_for_upload", return_value=(b"mp3", "masked.mp3")) as compress:
                self.assertEqual(stt._audio_for_transcription(audio), (b"mp3", "masked.mp3"))
            compress.assert_called_once_with(audio)

    def test_rejects_oversize_transcode(self):
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "track.flac"
            audio.write_bytes(b"original")
            with mock.patch.object(stt, "_compress_for_upload", return_value=(b"x" * (stt.OPENAI_MAX_BYTES + 1), "track.mp3")):
                with self.assertRaises(stt._llm.LLMError):
                    stt._audio_for_transcription(audio)


if __name__ == "__main__":
    unittest.main()
