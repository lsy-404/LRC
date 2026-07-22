#!/usr/bin/env python3
"""ingest/lyrics.py — 歌词/credits 文本解析工具。

处理两类常见投递：
- 逐曲歌词 txt：首行标题 + 分曲 staff(VOCAL/MUSIC/LYRICS/TUNING…) + 空行 + 正文。
- 专辑级 credits（如 Staff表.txt）：只有制作信息、几乎无歌词正文。
"""
from __future__ import annotations

import re
from pathlib import Path

# 分曲/专辑 staff 标签 → meta internal 字段
STAFF_LABELS = {
    "VOCAL": "vocal", "演唱": "vocal", "主唱": "vocal", "歌手": "vocal",
    "MUSIC": "composer", "作曲": "composer", "曲": "composer",
    "COMPOSE": "composer", "COMPOSER": "composer",
    "ARRANGE": "arranger", "ARRANGEMENT": "arranger", "编曲": "arranger",
    "LYRICS": "lyricist", "LYRIC": "lyricist", "作词": "lyricist", "词": "lyricist",
    "TUNING": "tuning", "TUNE": "tuning", "调校": "tuning", "调教": "tuning",
    "ILLUSTRATION": "illustrator", "ILLUST": "illustrator", "曲绘": "illustrator",
    "封面": "illustrator", "美术": "illustrator", "ILLUSTRATOR": "illustrator",
    "MIX": "mixer", "MIXING": "mixer", "混音": "mixer", "MIXER": "mixer",
    "MASTERING": "mastering", "MASTER": "mastering", "母带": "mastering",
    "PV": "video", "VIDEO": "video", "MOVIE": "video", "视频": "video",
    "PLANNING": "planning", "PLAN": "planning", "策划": "planning", "企划": "planning",
}

_LEAD_NUM = re.compile(r"^\s*\d+[\.\s、]*")
_STAFF_LINE = re.compile(r"^\s*([A-Za-z一-鿿]+)\s*[:：]?\s+(.+)$")


def _is_staff_label(token: str) -> str | None:
    return STAFF_LABELS.get(token.strip().upper()) or STAFF_LABELS.get(token.strip())


def split_names(raw: str) -> list[str]:
    """把一行人名拆成列表：支持 & 、 空格 / , ， 等分隔，去 @ 后缀。"""
    parts = re.split(r"[&、,，/]|\s{1,}", raw.strip())
    out: list[str] = []
    for p in parts:
        p = re.sub(r"\s*@\S+$", "", p).strip()
        if p and p.upper() not in STAFF_LABELS:
            out.append(p)
    return out


def parse_staff_block(lines: list[str]) -> dict[str, list[str]]:
    """从若干行里解析 staff（支持「LABEL 名字...」单行，或「LABEL\\n名字」块）。"""
    staff: dict[str, list[str]] = {}
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        # 形如 "VOCAL 星尘&海伊"
        m = _STAFF_LINE.match(line)
        if m and _is_staff_label(m.group(1)):
            field = _is_staff_label(m.group(1))
            staff.setdefault(field, []).extend(split_names(m.group(2)))
            i += 1
            continue
        # 形如 单独一行 "VOCAL" 下一行是名字
        field = _is_staff_label(line)
        if field and i + 1 < len(lines):
            staff.setdefault(field, []).extend(split_names(lines[i + 1]))
            i += 2
            continue
        i += 1
    # 去重保序
    for k, v in staff.items():
        seen = set()
        staff[k] = [x for x in v if not (x in seen or seen.add(x))]
    return staff


def is_credits_only(text: str) -> bool:
    """判断一个 txt 是否为专辑级 credits（几乎无歌词正文）。"""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return False
    staff_hits = sum(1 for l in lines if _is_staff_label(l.split()[0]) if l.split())
    # staff 标签占比高、且总行数不多 → credits
    return staff_hits >= 3 and staff_hits >= len(lines) * 0.3


def parse_lyric_txt(path: Path) -> dict:
    """逐曲歌词 txt → {title, lines(纯歌词), staff}。

    规则：首行=标题（去前导序号）；首个空行前的 staff 行解析为分曲 staff；
    空行后为正文。无空行时跳过开头的 staff 行。
    """
    raw = path.read_text(encoding="utf-8", errors="replace").splitlines()
    title = _LEAD_NUM.sub("", raw[0]).strip() if raw else path.stem
    blank = next((i for i, l in enumerate(raw) if l.strip() == ""), None)
    if blank is not None:
        header, body = raw[1:blank], raw[blank + 1 :]
    else:
        header, body = [], raw[1:]
        # 无空行：把开头的 staff 行从 body 里剥离
        while body and (_STAFF_LINE.match(body[0]) and _is_staff_label(body[0].split()[0])):
            header.append(body.pop(0))
    staff = parse_staff_block(header)
    lines = [l.strip() for l in body if l.strip()]
    return {"title": title, "lines": lines, "staff": staff}
