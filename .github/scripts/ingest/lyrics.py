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
    "和声": "vocal", "CHORUS": "vocal", "HARMONY": "vocal",
}

_LEAD_NUM = re.compile(r"^\s*\d+[\.\s、]*")
_STAFF_LINE = re.compile(
    r"^\s*([A-Za-z一-鿿]+(?:\s*[/／]\s*[A-Za-z一-鿿]+)*)\s*(?:[:：]\s*|\s+)(.+)$")


def _is_staff_label(token: str) -> str | None:
    return STAFF_LABELS.get(token.strip().upper()) or STAFF_LABELS.get(token.strip())


def _labels_of(token: str) -> list[str] | None:
    """「作词」→[lyricist]；复合标签「作词/作曲」→[lyricist, composer]（歌词本常见排版，
    同一人担任多个角色）。任一部分不是已知 staff 标签则整体判非 staff 行，返回 None。"""
    parts = [p for p in re.split(r"[/／]", token) if p.strip()]
    fields = [_is_staff_label(p) for p in parts]
    if fields and all(fields):
        return [f for f in fields if f]
    return None


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
        # 形如 "VOCAL 星尘&海伊" / "作词/作曲：奥莉安多"（复合标签拆给每个角色）
        m = _STAFF_LINE.match(line)
        fields = _labels_of(m.group(1)) if m else None
        if m and fields:
            for field in fields:
                staff.setdefault(field, []).extend(split_names(m.group(2)))
            i += 1
            continue
        # 形如 单独一行 "VOCAL" 下一行是名字
        fields = _labels_of(line)
        if fields and i + 1 < len(lines):
            for field in fields:
                staff.setdefault(field, []).extend(split_names(lines[i + 1]))
            i += 2
            continue
        i += 1
    # 去重保序
    for k, v in staff.items():
        seen = set()
        staff[k] = [x for x in v if not (x in seen or seen.add(x))]
    return staff


def to_simplified(text: str) -> str:
    """繁→简。站点数据规范为简体；OCR 提示词的简体规则约束不了 whisper 转写
    （中文输出天然偏繁体），在数据层做确定性转换。仅限中文语境调用——
    日语文本经此函数会被错误改写，调用方必须先判语言。"""
    from zhconv import convert
    return convert(text, "zh-cn")


# Whisper 可能用粤语、吴语等变体语言码标记中文。它们与 zh 同样要遵守本站简体规范；
# 日语等其他 CJK 语言绝不能调用繁简转换。
_CHINESE_LANGS = {"zh", "yue", "cmn", "wuu", "nan", "hak", "gan", "cdo"}


def is_chinese_language(language: str) -> bool:
    lang = str(language or "").lower().replace("_", "-")
    return lang in _CHINESE_LANGS or lang.startswith("zh-")


def split_staff_lines(lines: list[str]) -> tuple[dict[str, list[str]], list[str], list[str]]:
    """把行列表分成 (staff字段, 原样staff行, 歌词正文行)。

    staff 行是元信息，不应进入带时间轴的歌词正文；原样行保留用于
    双模式输出（头部 [ti:][ar:][by:] 标签 + 正文未计时 credit 行，
    站点解析侧两种模式都认）。
    """
    staff: dict[str, list[str]] = {}
    staff_rows: list[str] = []
    lyric_lines: list[str] = []
    for line in lines:
        s = line.strip()
        m = _STAFF_LINE.match(s)
        fields = _labels_of(m.group(1)) if m else None
        if m and fields:
            for f in fields:
                staff.setdefault(f, []).extend(split_names(m.group(2)))
            staff_rows.append(s)
        else:
            lyric_lines.append(line)
    for k, v in staff.items():
        seen = set()
        staff[k] = [x for x in v if not (x in seen or seen.add(x))]
    return staff, staff_rows, lyric_lines


def is_credits_only(text: str) -> bool:
    """判断一个 txt 是否为专辑级 credits（几乎无歌词正文）。"""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return False
    staff_hits = sum(1 for l in lines if _is_staff_label(l.split()[0]) if l.split())
    # staff 标签占比高、且总行数不多 → credits
    return staff_hits >= 3 and staff_hits >= len(lines) * 0.3


def parse_lyric_txt(path: Path, text: str | None = None) -> dict:
    """逐曲歌词 txt → {title, lines(纯歌词), staff}。

    规则：首行=标题（去前导序号）；首个空行前的 staff 行解析为分曲 staff；
    空行后为正文。无空行时跳过开头的 staff 行。
    """
    raw = (text if text is not None else path.read_text(encoding="utf-8", errors="replace")).splitlines()
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
