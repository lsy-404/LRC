from __future__ import annotations

from pathlib import Path

from lib.config_loader import load_config

CONFIG = load_config()
PROJECT = CONFIG.get("project", {})
COMMON = CONFIG.get("common", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))
COVER_EXTENSIONS = {str(item).lower() for item in COMMON.get("cover_ext", [".jpg", ".png", ".jpeg", ".webp", ".bmp"])}


def _normalize_cover_file(album_dir: Path) -> list[tuple[Path, Path]]:
    renames: list[tuple[Path, Path]] = []
    for file in album_dir.iterdir():
        if not file.is_file():
            continue
        if file.stem.lower() != "cover":
            continue
        ext_lower = file.suffix.lower()
        if ext_lower not in COVER_EXTENSIONS:
            continue
        target = file.with_name(f"cover{ext_lower}")
        if file.name == target.name:
            continue
        if target.exists() and target.resolve() != file.resolve():
            print(f"Skip rename, target exists: {target}")
            continue
        renames.append((file, target))
    return renames


def main() -> int:
    if not RES_DIR.exists():
        print(f"res directory not found: {RES_DIR}")
        return 1

    pending: list[tuple[Path, Path]] = []
    for album_dir in sorted([p for p in RES_DIR.iterdir() if p.is_dir()]):
        pending.extend(_normalize_cover_file(album_dir))

    if not pending:
        print("No cover filenames to normalize.")
        return 0

    for src, dst in pending:
        print(f"Rename: {src} -> {dst}")
        src.rename(dst)

    print(f"Normalized {len(pending)} cover file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
