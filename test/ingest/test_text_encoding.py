"""Uploaded lyric TXT files are decoded by their detected encoding."""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import pipeline  # noqa: E402


GB18030_LYRICS = (
    "群青町\n作词：水树\n\n僕らは群青町にいる\n"
    "我们仍在群青町里\n"
    "天空仍然是蓝色\n"
)
UTF8_LYRICS = "星海\n作词：示例作者\n\n仍然是正确的 UTF-8 歌词\n"


def _parse(path: Path) -> dict:
    text = pipeline.read_uploaded_text(path)
    return pipeline.lyrics_mod.parse_lyric_txt(path, text=text)


def test_decodes_gb18030_lyric_txt_before_parsing() -> None:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "11.群青町.txt"
        path.write_bytes(GB18030_LYRICS.encode("gb18030"))

        parsed = _parse(path)

    assert parsed["title"] == "群青町"
    assert parsed["staff"] == {"lyricist": ["水树"]}
    assert parsed["lines"] == ["僕らは群青町にいる", "我们仍在群青町里", "天空仍然是蓝色"]


def test_keeps_utf8_lyric_txt_unchanged() -> None:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "01 星海.txt"
        path.write_bytes(UTF8_LYRICS.encode("utf-8"))

        parsed = _parse(path)

    assert parsed["title"] == "星海"
    assert parsed["staff"] == {"lyricist": ["示例作者"]}
    assert parsed["lines"] == ["仍然是正确的 UTF-8 歌词"]


def run() -> int:
    test_decodes_gb18030_lyric_txt_before_parsing()
    test_keeps_utf8_lyric_txt_unchanged()
    print("2/2 通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
