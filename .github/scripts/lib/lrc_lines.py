from __future__ import annotations

import re
from pathlib import Path

_TIME_TAG_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
_CHAR_TAG_RE = re.compile(r"<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>")
_DECODE_ORDER = ("utf-8-sig", "utf-8", "gb18030", "gbk")


def decode_lrc_bytes(raw: bytes) -> str:
    for encoding in _DECODE_ORDER:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _ts_to_seconds(match: re.Match) -> float:
    minutes = int(match.group(1))
    seconds = int(match.group(2))
    fraction = match.group(3) or "0"
    frac_seconds = int(fraction) / (10 ** len(fraction))
    return minutes * 60 + seconds + frac_seconds


def _split_char_tags(text: str) -> tuple[str, list[dict]]:
    """拆分行内逐字标签 `<mm:ss.xx>字`，返回 (纯净文本, 逐字时间列表)。

    标签前若有无标签前导文本（未对齐上的字），保留在纯净文本中但不计入 words
    （没有可用时间戳）。无标签时 words 为空列表。
    """
    matches = list(_CHAR_TAG_RE.finditer(text))
    if not matches:
        return text, []
    words: list[dict] = []
    parts = [text[: matches[0].start()]]
    for i, match in enumerate(matches):
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end]
        parts.append(chunk)
        if chunk:
            words.append({"time": round(_ts_to_seconds(match), 2), "text": chunk})
    return "".join(parts), words


def parse_lrc_lines(content: str) -> list[dict]:
    """解析 LRC 文本为按时间排序的结构化行 [{time, text, words?}, ...]。

    一行多时间戳 [t1][t2]text 按时间戳个数展开为多条记录；
    不带时间戳的元信息标签（如 [ti:] [ar:]）被忽略。
    行内逐字标签 `<mm:ss.xx>字`（ingest 强制对齐产出）被解析为 `words`
    字段并从 `text` 中剥离；没有逐字标签的行不带 `words` 键。
    """
    entries: list[dict] = []
    for raw_line in content.splitlines():
        matches = list(_TIME_TAG_RE.finditer(raw_line))
        if not matches:
            continue
        raw_text = _TIME_TAG_RE.sub("", raw_line).strip()
        if not raw_text:
            continue
        text, words = _split_char_tags(raw_text)
        text = text.strip()
        if not text:
            continue
        for match in matches:
            entry = {"time": round(_ts_to_seconds(match), 2), "text": text}
            if words:
                entry["words"] = words
            entries.append(entry)

    entries.sort(key=lambda item: item["time"])
    return entries


def load_lrc_lines(file_path: Path) -> list[dict]:
    return parse_lrc_lines(decode_lrc_bytes(file_path.read_bytes()))
