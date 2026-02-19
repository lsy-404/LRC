from __future__ import annotations

import re
from pathlib import Path

RES_DIR = Path(__file__).resolve().parents[2] / "res"


def _decode_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def normalize_year_text(value: str) -> str | None:
    text = (value or "").strip()
    match = re.fullmatch(r"(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?", text)
    if not match:
        return None

    year = int(match.group(1))
    month = int(match.group(2)) if match.group(2) else 1
    day = int(match.group(3)) if match.group(3) else 1

    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None

    return f"{year:04d}-{month:02d}-{day:02d}"


def main() -> None:
    albums = sorted([path for path in RES_DIR.iterdir() if path.is_dir()], key=lambda p: p.name)

    for album_dir in albums:
        meta_path = album_dir / "meta.toml"
        if not meta_path.exists():
            continue

        try:
            content = _decode_bytes(meta_path.read_bytes())
            def replace_year_line(match: re.Match[str]) -> str:
                key_name = match.group(1)
                raw_value = match.group(2)
                normalized = normalize_year_text(raw_value)
                if normalized is None:
                    return match.group(0)
                return f'{key_name} = "{normalized}"'

            updated = re.sub(r'^(年份|发行日期)\s*=\s*"([^"]+)"\s*$', replace_year_line, content, flags=re.MULTILINE)
            meta_path.write_text(updated, encoding="utf-8")
            print(f"Updated: {album_dir.name}")
        except Exception as error:
            print(f"Failed to update {album_dir.name}: {error}")

    print("All TOML files updated successfully.")


if __name__ == "__main__":
    main()
