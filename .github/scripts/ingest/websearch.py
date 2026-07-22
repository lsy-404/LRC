#!/usr/bin/env python3
"""ingest/websearch.py — 联网检索专辑的官方元信息（staff/制作者），不涉及歌词。

歌词本可能没印全 staff（如母带/出品），或实拍 OCR 读不全 credits 页；
公开发布过的专辑用联网检索到的官方元信息填补空缺字段。
歌词正文始终只来自投稿素材（歌词本 OCR + STT 对齐），不从网络获取。
"""
from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from ingest import _llm  # type: ignore
else:
    from . import _llm

ALBUM_PROMPT = """请联网搜索专辑《{album}》{artist_hint}的官方发布元信息（制作 staff，不需要歌词）。
优先权威来源：vocadb / 萌娘百科 / Bilibili 官方投稿简介 / dizzylab / 网易云音乐官方条目。
{titles_hint}
输出 JSON（只填来源明确写出的字段，找不到的留空数组；人名用简体中文）：
{{"found": true, "source": "来源URL",
  "staff": {{"作词": [], "作曲": [], "编曲": [], "调校": [], "混音": [], "母带": [], "曲绘": [], "视频": [], "策划": [], "演唱": [], "出品": []}}}}
若检索不到该专辑的可靠信息，输出 {{"found": false}}。只输出 JSON，不要任何解释。"""


def available() -> bool:
    return _llm.api_base() == _llm.OPENAI_API_BASE and bool(_llm._env("LLM_API_KEY"))


def search_album_meta(album: str, artist: str = "", titles: list[str] | None = None) -> dict:
    """检索专辑官方元信息。返回 {"found": bool, "staff": {...}}；请求失败抛 LLMError。"""
    artist_hint = f"（创作者/歌手：{artist}）" if artist else ""
    titles_hint = f"参考曲目：{'、'.join(titles)}\n" if titles else ""
    resp = _llm.search_chat(
        ALBUM_PROMPT.format(album=album, artist_hint=artist_hint, titles_hint=titles_hint))
    data = _llm.extract_json(resp)
    return data if isinstance(data, dict) else {"found": False}
