"""从 LRC 歌词文件提取内嵌的基础元数据字段。

支持识别以下格式
──────────────────────────────────────────────────────────
标准 LRC 标签（无时间戳）：
    [ti:Strayed Stalker - 迷路的跟踪狂]
    [ar:星尘、苍穹]
    [al:丛林法则Jungle Rules]
    [by:RQvan]

时间戳嵌入式字段（冒号前后可含空格）：
    [00:04.00]演唱：星尘、苍穹
    [00:00.01]作曲 : 崽无儿音

时间戳嵌入式联合字段（& 分隔多个字段名共用同一值）：
    [00:05.49]作曲&编曲：PoKeR

缩写字段名：
    [00:04.00]曲：litterzy
    [00:05.00]词：大九_LN
    [00:06.00]调：litterzy
    [00:07.00]绘：多尔及利亚

曲名包裹形式：
    [00:00.00]《亵渎》
    [00:00.00]「Song Title」
    [00:00.00]【Song Title】
──────────────────────────────────────────────────────────
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .config_loader import load_config

_CONFIG = load_config()
_LRC_CONFIG = _CONFIG.get("lrc", {})
_META_CONFIG = _CONFIG.get("meta", {})

# ---------------------------------------------------------------------------
# 正则模式
# ---------------------------------------------------------------------------

# 标准 LRC ID 标签：[xx:内容]，不以数字:数字 开头（排除时间戳）
_LRC_TAG_RE = re.compile(r"^\[([A-Za-z][A-Za-z0-9]*):(.+?)\]\s*$")

# 时间戳前缀（可能多个连续时间戳，如 [00:04.00][01:23.00]）
_TIMESTAMPS_PREFIX_RE = re.compile(r"^(?:\[\d{1,3}:\d{2}(?:[.:]\d+)?\])+")

# 字段/值分割：中英文冒号，前后允许空格
_FIELD_SEP_RE = re.compile(r"\s*[：:]\s*")

# 联合字段分隔符号：、 , ， & ＆ / ／
_COMPOUND_SEP_RE = re.compile(r"[、,，&＆/／]")

# 人名/值列表分隔符（& / ＆ 同样作为并列分隔符）
_LIST_SEP_RE = re.compile(r"\s*[、,，&＆]\s*")

# 曲名包裹字符对
_TITLE_WRAP_RE = re.compile(r"^[《【「『〈](.+?)[》】」』〉]\s*$")

# ---------------------------------------------------------------------------
# 字段别名映射
# ---------------------------------------------------------------------------

#: 标准 LRC ID 标签 → 归一化字段
_LRC_ID_TAG: dict[str, str] = {
    **dict(_LRC_CONFIG.get("id_tag", {})),
}

#: 歌词行里识别的字段别名 → 归一化字段
_ROW_FIELD_ALIAS: dict[str, str] = {
    **dict(_LRC_CONFIG.get("row_field_alias", {})),
}

#: 所有列表型字段
_LIST_FIELDS = set(_LRC_CONFIG.get("list_fields", _META_CONFIG.get("lrc_fillable", []))) - {"lyric_maker"}

# ---------------------------------------------------------------------------
# 编码解码辅助
# ---------------------------------------------------------------------------

def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _clean_bom(text: str) -> str:
    """移除文本中的BOM字符（U+FEFF），包括开头和中间位置。"""
    return text.replace('\ufeff', '')


# ---------------------------------------------------------------------------
# 解析辅助函数
# ---------------------------------------------------------------------------

def _split_list(value: str) -> list[str]:
    """将人名/值字符串按分隔符拆分，返回非空列表。移除每个元素中的BOM字符。"""
    return [_clean_bom(item.strip()) for item in _LIST_SEP_RE.split(value) if item.strip()]


def _decompose_field_name(raw: str) -> list[str]:
    """将可能是联合字段名的字符串拆分为各独立字段名，例如 '作曲&编曲' → ['作曲', '编曲']。"""
    parts = _COMPOUND_SEP_RE.split(raw)
    return [p.strip() for p in parts if p.strip()]


def _strip_timestamps(line: str) -> str | None:
    """
    若行以时间戳开头则去掉所有前缀时间戳，返回剩余内容（可能为空字符串）。
    若不含时间戳前缀则返回 None。
    """
    m = _TIMESTAMPS_PREFIX_RE.match(line)
    if not m:
        return None
    return line[m.end():].strip()


# ---------------------------------------------------------------------------
# 核心提取函数
# ---------------------------------------------------------------------------

def extract_lrc_metadata(file_path: Path) -> dict[str, Any]:
    """
    从单个 LRC 文件提取内嵌元数据，返回如下结构::

        {
            "title":      str,         # [ti:...] 标签中的标题
            "artist":     str,         # [ar:...] 标签中的艺术家
            "album":      str,         # [al:...] 标签中的专辑名
            "lyric_maker": str,        # [by:...] 或 [lrc by:...] 标签中的歌词制作者
            "song_title": str,         # 正文 《曲名》 形式的标题
            "vocal":      list[str],   # 演唱者
            "composer":   list[str],   # 作曲者
            "arranger":   list[str],   # 编曲者
            "lyricist":   list[str],   # 作词者
            "tuning":     list[str],   # 调校者
            "illustrator":list[str],   # 曲绘/封面绘制
            "mixer":      list[str],   # 混音者
            "album_tag":  str,         # 正文 专辑：xxx 字段
        }

    同一字段出现多次时，列表型字段取并集（去重保序），字符串型字段取首次有效值。
    """
    meta: dict[str, Any] = {
        "title": "",
        "artist": "",
        "album": "",
        "lyric_maker": "",
        "song_title": "",
        "vocal": [],
        "composer": [],
        "arranger": [],
        "lyricist": [],
        "tuning": [],
        "illustrator": [],
        "mixer": [],
        "album_tag": "",
    }
    # 用 set 加速去重，最后还原为列表
    _seen: dict[str, set] = {k: set() for k in _LIST_FIELDS}

    raw = file_path.read_bytes()
    content = _decode(raw)

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # ── 1. 标准 LRC ID 标签 [ti:...] [ar:...] [al:...] [by:...] ──────────
        tag_m = _LRC_TAG_RE.match(line)
        if tag_m:
            tag_key = tag_m.group(1).lower()
            tag_val = tag_m.group(2).strip()
            field = _LRC_ID_TAG.get(tag_key)
            if field and tag_val and not meta[field]:
                meta[field] = tag_val
            continue

        # ── 2. 时间戳行 ────────────────────────────────────────────────────────
        content_part = _strip_timestamps(line)
        if content_part is None:
            # 既无 ID 标签也无时间戳前缀 → 普通行，跳过
            continue

        if not content_part:
            continue  # 空时间戳行

        # 2a. 检查是否为嵌套的 LRC 标签（如 [lrc by：Magicst]）
        # 先尝试标准格式 [tag:value]
        nested_tag_m = _LRC_TAG_RE.match(content_part)
        if nested_tag_m:
            tag_key = nested_tag_m.group(1).lower()
            tag_val = nested_tag_m.group(2).strip()
            field = _LRC_ID_TAG.get(tag_key)
            if field and tag_val and not meta[field]:
                meta[field] = tag_val
            continue
        
        # 特殊处理 [lrc by：xxx] 格式（包含空格的标签名）
        lrc_by_m = re.match(r'^\[lrc\s+by\s*[：:]\s*(.+?)\]\s*$', content_part, re.IGNORECASE)
        if lrc_by_m:
            if not meta["lyric_maker"]:
                meta["lyric_maker"] = lrc_by_m.group(1).strip()
            continue

        # 2b. 曲名包裹：《亵渎》 / 【Title】 / 「Title」
        wrap_m = _TITLE_WRAP_RE.match(content_part)
        if wrap_m:
            if not meta["song_title"]:
                meta["song_title"] = wrap_m.group(1).strip()
            continue

        # 2c. 字段：值（含联合字段 "作曲&编曲：PoKeR"）
        # 用 maxsplit=1 只在第一个冒号处分割
        parts = _FIELD_SEP_RE.split(content_part, maxsplit=1)
        if len(parts) != 2:
            continue  # 无法解析为 "字段：值" 格式

        field_raw, value = parts[0].strip(), parts[1].strip()
        # 清理值中可能存在的BOM字符
        value = _clean_bom(value)
        if not field_raw or not value:
            continue

        # 拆分联合字段名
        field_names = _decompose_field_name(field_raw)
        for fname in field_names:
            canonical = _ROW_FIELD_ALIAS.get(fname)
            if not canonical:
                continue

            if canonical in _LIST_FIELDS:
                persons = _split_list(value)
                for p in persons:
                    if p and p not in _seen[canonical]:
                        _seen[canonical].add(p)
                        meta[canonical].append(p)
            else:
                # 字符串字段：只取首次
                if not meta[canonical]:
                    meta[canonical] = value

    return meta


def merge_album_lrc_metadata(lrc_files: list[Path]) -> dict[str, Any]:
    """
    聚合一张专辑内所有 LRC 文件提取到的元数据，取各列表字段的并集（去重保序）。

    返回结构与 :func:`extract_lrc_metadata` 相同（字符串字段取首次有效值）。
    """
    merged: dict[str, Any] = {
        "title": "",
        "artist": "",
        "album": "",
        "lyric_maker": "",
        "song_title": "",
        "vocal": [],
        "composer": [],
        "arranger": [],
        "lyricist": [],
        "tuning": [],
        "illustrator": [],
        "mixer": [],
        "album_tag": "",
    }
    _seen: dict[str, set] = {k: set() for k in _LIST_FIELDS}

    for lrc in lrc_files:
        song_meta = extract_lrc_metadata(lrc)
        for field in _LIST_FIELDS:
            for person in song_meta.get(field, []):
                if person and person not in _seen[field]:
                    _seen[field].add(person)
                    merged[field].append(person)
        # 字符串字段只采纳首次有效值
        for field in ("title", "artist", "album", "lyric_maker", "song_title", "album_tag"):
            if not merged[field] and song_meta.get(field):
                merged[field] = song_meta[field]

    return merged
