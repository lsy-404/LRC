from __future__ import annotations

import re

from pypinyin import lazy_pinyin

_HAN_RE = re.compile(r"[一-鿿]")
_NON_ASCII_ARTIFACT_RE = re.compile(r"[^A-Za-z0-9_\-\n]+")


def sanitize_artifact_name(raw_name: str) -> str:
    text = (raw_name or "").strip()
    if not text:
        return "album"

    # 中英相邻时先插入分隔符，避免拼音与英文粘连
    text = re.sub(r"(?<=[一-鿿])(?=[A-Za-z])", "_", text)
    text = re.sub(r"(?<=[A-Za-z])(?=[一-鿿])", "_", text)

    converted_parts: list[str] = []
    for ch in text:
        if _HAN_RE.fullmatch(ch):
            py = "".join(lazy_pinyin(ch, errors="ignore"))
            if py:
                converted_parts.append(py)
        else:
            converted_parts.append(ch)

    converted = "".join(converted_parts)
    converted = converted.replace(" ", "_")
    converted = _NON_ASCII_ARTIFACT_RE.sub("", converted)
    converted = re.sub(r"_+", "_", converted)
    converted = re.sub(r"-+", "-", converted)
    converted = converted.strip("_-")

    return converted or "album"


def natural_sort_key(name: str) -> tuple:
    """曲目文件名自然排序键：按前导序号数值排（11 不再排在 2 之前），无序号的排最后。"""
    import re
    m = re.match(r"\s*(\d+)", name)
    return (int(m.group(1)) if m else 10**9, name)
