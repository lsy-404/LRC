import codecs
import json
import os
import re
from pathlib import Path


def decode_octal(raw: str) -> str:
    if not raw or "\\" not in raw:
        return raw
    if not re.search(r"\\[0-7]{3}", raw):
        return raw
    try:
        decoded = codecs.decode(raw, "unicode_escape")
    except Exception:
        return raw
    try:
        return decoded.encode("latin-1").decode("utf-8")
    except UnicodeDecodeError:
        return decoded


def try_load_json(raw: str):
    try:
        return json.loads(raw)
    except Exception:
        return None


def clean_item(item: str) -> str:
    cleaned = (item or "").strip()
    if len(cleaned) >= 2 and cleaned[0] == '"' and cleaned[-1] == '"':
        cleaned = cleaned[1:-1]
    return decode_octal(cleaned)


def split_changed_files(raw: str) -> list[str]:
    if not raw:
        return []
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        unwrapped = try_load_json(raw)
        if unwrapped is not None:
            raw = unwrapped
    if isinstance(raw, str):
        raw = raw.strip()
        if raw == "[]":
            return []
    if isinstance(raw, str) and raw.startswith("[") and raw.endswith("]"):
        parsed = try_load_json(raw)
        if parsed is None:
            decoded = decode_octal(raw)
            if decoded != raw:
                parsed = try_load_json(decoded)
        if isinstance(parsed, str):
            parsed = try_load_json(parsed)
        if isinstance(parsed, list):
            return [clean_item(str(item)) for item in parsed if str(item).strip()]
    if isinstance(raw, str) and "\n" in raw:
        return [clean_item(line) for line in raw.splitlines() if line.strip()]
    if isinstance(raw, str):
        return [clean_item(item) for item in re.split(r"\s+", raw) if item]
    return []


def write_toml(path: Path, items: list[str]) -> None:
    with path.open("w", encoding="utf-8") as f:
        f.write("files = [\n")
        for item in items:
            f.write(f"  {json.dumps(item, ensure_ascii=False)},\n")
        f.write("]\n")


def main() -> int:
    raw_changed = os.getenv("RAW_CHANGED", "")
    raw_deleted = os.getenv("RAW_DELETED", "")
    changed_out = Path(os.getenv("CHANGED_FILES_TOML_OUT", ".changed_files.toml"))
    deleted_out = Path(os.getenv("DELETED_FILES_TOML_OUT", ".deleted_files.toml"))

    changed = split_changed_files(raw_changed)
    deleted = split_changed_files(raw_deleted)

    write_toml(changed_out, changed)
    write_toml(deleted_out, deleted)

    print(f"Wrote {len(changed)} changed file(s) to {changed_out}")
    print(f"Wrote {len(deleted)} deleted file(s) to {deleted_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
