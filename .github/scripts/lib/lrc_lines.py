from __future__ import annotations

import re
from pathlib import Path

_TIME_TAG_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
_DECODE_ORDER = ("utf-8-sig", "utf-8", "gb18030", "gbk")


def decode_lrc_bytes(raw: bytes) -> str:
    for encoding in _DECODE_ORDER:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_lrc_lines(content: str) -> list[dict]:
    """解析 LRC 文本为按时间排序的结构化行 [{time: float, text: str}, ...]。

    一行多时间戳 [t1][t2]text 按时间戳个数展开为多条记录；
    不带时间戳的元信息标签（如 [ti:] [ar:]）被忽略。
    """
    entries: list[dict] = []
    for raw_line in content.splitlines():
        matches = list(_TIME_TAG_RE.finditer(raw_line))
        if not matches:
            continue
        text = _TIME_TAG_RE.sub("", raw_line).strip()
        if not text:
            continue
        for match in matches:
            minutes = int(match.group(1))
            seconds = int(match.group(2))
            fraction = match.group(3) or "0"
            frac_seconds = int(fraction) / (10 ** len(fraction))
            time_seconds = minutes * 60 + seconds + frac_seconds
            entries.append({"time": round(time_seconds, 2), "text": text})

    entries.sort(key=lambda item: item["time"])
    return entries


def load_lrc_lines(file_path: Path) -> list[dict]:
    return parse_lrc_lines(decode_lrc_bytes(file_path.read_bytes()))
