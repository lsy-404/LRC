from __future__ import annotations

from pathlib import Path

from lib.meta_parser import load_album_meta

TEST_FILE_DIR = Path("f:/Development/LRC/res/ELOHIM")


def main() -> None:
    print("=== TOML Parsing Test ===\n")

    info, source = load_album_meta(TEST_FILE_DIR)
    if source is None:
        print("No meta.toml/info.toml found")
        return

    raw = source.read_bytes()
    print(f"Source: {source}")
    print(f"File size: {len(raw)} bytes")
    print(f"First 20 bytes (hex): {raw[:20].hex()}")
    print("\nParsed fields:")
    print(f"  年份: {info['year']}")
    print(f"  出品: {info['produce']}")
    print(f"  演唱: {info['vocal']}")
    print(f"  发布: {info['release']}")
    print(f"  购买: {info['purchase']}")
    print(f"  歌词制作: {info['lyric_maker']}")


if __name__ == "__main__":
    main()
