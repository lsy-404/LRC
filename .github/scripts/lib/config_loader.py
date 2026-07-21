from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

try:
    import tomllib  # py311+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None


DEFAULT_CONFIG: dict[str, Any] = {
    "project": {
        "repo": "wuyilingwei/LRC",
        "res_dir": "res",
        "docs_dir": "docs",
        "albums_dir": "docs/albums",
        "pack_dir": "pack",
        "readme_path": "README.md",
    },
    "common": {
        "cover_ext": [".jpg", ".png", ".jpeg", ".webp", ".bmp"],
    },
    "pull": {
        "whitelist_url": ["bilibili.com", "b23.tv", "taobao.com", "tb.cn", "m.tb.cn", "e.tb.cn", "dizzylab.com"],
        "lrc_max_kb": 20,
        "klrc_max_kb": 80,
        "meta_max_kb": 5,
        "cover_max_mb": 5,
        "max_files_per_folder": 60,
        "cover_name": "cover",
        "meta_name": "meta.toml",
    },
    "meta": {
        "decode_order": ["utf-8-sig", "utf-8", "gb18030", "gbk"],
        "lrc_fillable": ["vocal", "lyricist", "composer", "arranger", "tuning", "illustrator", "mixer", "lyric_maker"],
        "defaults": {
            "year": "",
            "produce": [],
            "prefix": "",
            "zh_name": "",
            "en_name": "",
            "suffix": "",
            "vocal": [],
            "lyricist": [],
            "composer": [],
            "arranger": [],
            "tuning": [],
            "illustrator": [],
            "mixer": [],
            "lyric_maker": [],
            "release": "",
            "purchase": "",
            "electronic": "",
        },
        "mapping": {
            "年份": "year",
            "发行日期": "year",
            "year": "year",
            "release_date": "year",
            "出品": "produce",
            "produce": "produce",
            "前缀": "prefix",
            "prefix": "prefix",
            "中文名": "zh_name",
            "zh_name": "zh_name",
            "英文名": "en_name",
            "en_name": "en_name",
            "后缀": "suffix",
            "suffix": "suffix",
            "演唱": "vocal",
            "vocal": "vocal",
            "作词": "lyricist",
            "lyricist": "lyricist",
            "作曲": "composer",
            "composer": "composer",
            "编曲": "arranger",
            "arranger": "arranger",
            "调校": "tuning",
            "tuning": "tuning",
            "曲绘": "illustrator",
            "illustrator": "illustrator",
            "混音": "mixer",
            "mixer": "mixer",
            "发布": "release",
            "release": "release",
            "购买": "purchase",
            "purchase": "purchase",
            "电子": "electronic",
            "electronic": "electronic",
            "歌词制作": "lyric_maker",
            "lyric_maker": "lyric_maker",
        },
        "field_schema": [
            {"internal": "year", "toml_key": "发行日期", "type": "str"},
            {"internal": "produce", "toml_key": "出品", "type": "list"},
            {"internal": "prefix", "toml_key": "前缀", "type": "str"},
            {"internal": "zh_name", "toml_key": "中文名", "type": "str"},
            {"internal": "en_name", "toml_key": "英文名", "type": "str"},
            {"internal": "suffix", "toml_key": "后缀", "type": "str"},
            {"internal": "lyric_maker", "toml_key": "歌词制作", "type": "list"},
            {"internal": "release", "toml_key": "发布", "type": "str"},
            {"internal": "purchase", "toml_key": "购买", "type": "str"},
            {"internal": "electronic", "toml_key": "电子", "type": "str"},
            {"internal": "vocal", "toml_key": "演唱", "type": "list"},
            {"internal": "lyricist", "toml_key": "作词", "type": "list"},
            {"internal": "composer", "toml_key": "作曲", "type": "list"},
            {"internal": "arranger", "toml_key": "编曲", "type": "list"},
            {"internal": "tuning", "toml_key": "调校", "type": "list"},
            {"internal": "illustrator", "toml_key": "曲绘", "type": "list"},
            {"internal": "mixer", "toml_key": "混音", "type": "list"},
        ],
    },
    "lrc": {
        "list_fields": ["vocal", "composer", "arranger", "lyricist", "tuning", "illustrator", "mixer"],
        "id_tag": {"ti": "title", "ar": "artist", "al": "album", "by": "lyric_maker", "lrc by": "lyric_maker"},
        "row_field_alias": {
            "演唱": "vocal",
            "主唱": "vocal",
            "歌手": "vocal",
            "作曲": "composer",
            "曲": "composer",
            "编曲": "arranger",
            "作词": "lyricist",
            "词": "lyricist",
            "调校": "tuning",
            "调": "tuning",
            "曲绘": "illustrator",
            "绘": "illustrator",
            "封面": "illustrator",
            "美术": "illustrator",
            "混音": "mixer",
            "专辑": "album_tag",
        },
    },
    "optimize": {
        "exclude_dirs": [".git", ".github", "scripts", "node_modules", ".vscode"],
        "extensions": [".lrc"],
    },
}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def get_root_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def get_config_path() -> Path:
    return get_root_dir() / ".github" / "config" / "config.toml"


def load_config() -> dict[str, Any]:
    config = deepcopy(DEFAULT_CONFIG)
    path = get_config_path()
    if not path.exists() or tomllib is None:
        return config

    try:
        parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return config

    return _deep_merge(config, parsed)
