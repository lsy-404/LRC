from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from lib.config_loader import load_config
from lib.lrc_lines import load_lrc_lines
from lib.meta_parser import load_album_meta
from lib.naming import natural_sort_key, sanitize_artifact_name

CONFIG = load_config()
PROJECT = CONFIG.get("project", {})
COMMON = CONFIG.get("common", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))
DOCS_DIR = ROOT_DIR / str(PROJECT.get("docs_dir", "docs"))
API_DIR = DOCS_DIR / ".vuepress" / "public" / "api"
COVER_EXTENSIONS = [str(item) for item in COMMON.get("cover_ext", [".jpg", ".png", ".jpeg", ".webp", ".bmp"])]

_DISABLED_VALUES = {"", "不适用", "缺少信息"}


def is_disabled_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0 or all(str(v).strip() in _DISABLED_VALUES for v in value)
    return str(value).strip() in _DISABLED_VALUES


def clean_str(value: Any) -> str:
    return "" if is_disabled_value(value) else str(value).strip()


def clean_list(value: Any) -> list[str]:
    if is_disabled_value(value):
        return []
    return [str(v).strip() for v in value if str(v).strip() not in _DISABLED_VALUES]


def find_cover(album_path: Path) -> tuple[Path | None, str]:
    for file in album_path.iterdir():
        if file.is_file() and file.stem.lower() == "cover":
            ext_lower = file.suffix.lower()
            if ext_lower in COVER_EXTENSIONS:
                return file, ext_lower
    return None, ""


def format_display_name(prefix: str, zh_name: str, en_name: str, suffix: str, fallback: str) -> str:
    if zh_name and en_name:
        main_name = f"{zh_name} {en_name}"
    else:
        main_name = zh_name or en_name

    parts = [part for part in (prefix, main_name, suffix) if part]
    return " ".join(parts) if parts else fallback


def _merge_word_timings(lyrics: list[dict[str, Any]], elrc_file: Path) -> list[dict[str, Any]]:
    """把 .elrc 侧车文件（逐字增强 LRC）的 words 合并进标准 .lrc 解析出的行列表。

    .elrc 与对应 .lrc 由同一次 align() 对齐产出，行时间戳逐字节相同，按 time 精确匹配。
    没有 .elrc（未匹配到音频/旧数据）时原样返回，行上不出现 words 键。
    """
    if not elrc_file.is_file():
        return lyrics
    words_by_time = {
        entry["time"]: entry["words"] for entry in load_lrc_lines(elrc_file) if entry.get("words")
    }
    for entry in lyrics:
        words = words_by_time.get(entry["time"])
        if words:
            entry["words"] = words
    return lyrics


def build_album_entry(album_dir: Path) -> dict[str, Any]:
    info, _ = load_album_meta(album_dir)
    slug = sanitize_artifact_name(album_dir.name)

    prefix = clean_str(info.get("prefix"))
    zh_name = clean_str(info.get("zh_name"))
    en_name = clean_str(info.get("en_name"))
    suffix = clean_str(info.get("suffix"))
    display_name = format_display_name(prefix, zh_name, en_name, suffix, album_dir.name)

    cover_file, cover_ext = find_cover(album_dir)
    cover_url = f"/albums/{slug}{cover_ext}" if cover_file else None

    lrc_files = sorted((path for path in album_dir.iterdir() if path.suffix.lower() == ".lrc"),
                       key=lambda p: natural_sort_key(p.name))
    songs = [
        {
            "title": lrc_file.stem,
            # elrc 标记仅在侧车存在时输出（可发现逐字歌词下载能力，维持字节纪律）
            **({"elrc": True} if lrc_file.with_suffix(".elrc").is_file() else {}),
            "lyrics": _merge_word_timings(load_lrc_lines(lrc_file), lrc_file.with_suffix(".elrc")),
        }
        for lrc_file in lrc_files
    ]

    tags = [album_dir.name]
    for tag_value in (prefix, zh_name, en_name, suffix):
        if tag_value:
            tags.append(tag_value)
    tags.extend(clean_list(info.get("produce")))
    tags = list(dict.fromkeys(tags))

    return {
        "slug": slug,
        "folder": album_dir.name,
        "name": display_name,
        "prefix": prefix,
        "zh_name": zh_name,
        "en_name": en_name,
        "suffix": suffix,
        "year": clean_str(info.get("year")),
        "produce": clean_list(info.get("produce")),
        "vocal": clean_list(info.get("vocal")),
        "lyricist": clean_list(info.get("lyricist")),
        "composer": clean_list(info.get("composer")),
        "arranger": clean_list(info.get("arranger")),
        "tuning": clean_list(info.get("tuning")),
        "illustrator": clean_list(info.get("illustrator")),
        "mixer": clean_list(info.get("mixer")),
        "lyric_maker": clean_list(info.get("lyric_maker")),
        "release": clean_str(info.get("release")),
        "purchase": clean_str(info.get("purchase")),
        "electronic": clean_str(info.get("electronic")),
        "cover": cover_url,
        "tags": tags,
        "songs": songs,
    }


def build_list_entry(album: dict[str, Any]) -> dict[str, Any]:
    """列表条目 = 完整专辑信息，仅将 songs 精简为不含歌词的 {title}。"""
    entry = dict(album)
    entry["songs"] = [{"title": song["title"]} for song in album["songs"]]
    entry["song_count"] = len(entry["songs"])
    entry["detail_url"] = f"/api/albums/{album['slug']}.json"
    return entry


def main() -> None:
    if API_DIR.exists():
        shutil.rmtree(API_DIR)
    (API_DIR / "albums").mkdir(parents=True, exist_ok=True)

    album_dirs = sorted((path for path in RES_DIR.iterdir() if path.is_dir()), key=lambda p: p.name)

    list_entries = []
    for album_dir in album_dirs:
        album = build_album_entry(album_dir)

        detail_path = API_DIR / "albums" / f"{album['slug']}.json"
        detail_path.write_text(
            json.dumps(album, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

        list_entries.append(build_list_entry(album))

    albums_index = {"count": len(list_entries), "albums": list_entries}
    (API_DIR / "albums.json").write_text(
        json.dumps(albums_index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"Generated API JSON for {len(list_entries)} albums under {API_DIR}")


if __name__ == "__main__":
    main()
