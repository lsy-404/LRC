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

ALBUM_PROMPT = """请联网搜索专辑《{album}》{artist_hint}的官方发布元信息（制作 staff 与发布/购买页，不需要歌词）。
优先权威来源：vocadb / 萌娘百科 / Bilibili 官方投稿简介 / dizzylab / 网易云音乐官方条目。
{titles_hint}{source_hint_line}
输出 JSON（只填来源明确写出的字段，找不到的留空；人名用简体中文；URL 必须是真实检索到的页面，不得拼造）：
{{"found": true, "source": "来源URL",
  "staff": {{"作词": [], "作曲": [], "编曲": [], "调校": [], "混音": [], "母带": [], "曲绘": [], "视频": [], "策划": [], "演唱": [], "出品": []}},
  "购买": "该专辑的官方购买/收听平台页 URL（如 dizzylab 专辑页），找不到留空",
  "发布": "该专辑的官方发布 PV/页面 URL，找不到留空"}}
若检索不到该专辑的可靠信息，输出 {{"found": false}}。只输出 JSON，不要任何解释。"""


def available() -> bool:
    return _llm.api_base() == _llm.OPENAI_API_BASE and bool(_llm._env("LLM_API_KEY"))


def download_cover(page_url: str, dest_dir: Path) -> Path | None:
    """从商品页（如 dizzylab 专辑页）下载封面：取 og:image。

    封面优先级第三档（显式 cover 文件 > 音频内嵌 tag > 商品页）。
    下载失败返回 None——封面是增强项，不该让整次摄取失败。
    """
    import re
    from urllib import request as _rq
    ua = {"User-Agent": "Mozilla/5.0 (LRC ingest cover fetch)"}
    try:
        with _rq.urlopen(_rq.Request(page_url, headers=ua), timeout=30) as r:
            html = r.read().decode("utf-8", "replace")
        m = (re.search(r'property=["\']og:image["\'][^>]*content=["\']([^"\']+)', html)
             or re.search(r'content=["\']([^"\']+)["\'][^>]*property=["\']og:image', html))
        if not m:
            print(f"  ⚠️ 商品页无 og:image: {page_url}", file=sys.stderr)
            return None
        img_url = m.group(1)
        with _rq.urlopen(_rq.Request(img_url, headers=ua), timeout=60) as r:
            data = r.read()
        ext = ".png" if data[:4] == b"\x89PNG" else ".jpg"
        out = dest_dir / f"web_cover{ext}"
        out.write_bytes(data)
        print(f"  ◉ 封面下载自商品页: {img_url}", file=sys.stderr)
        return out
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠️ 商品页封面下载失败: {e}", file=sys.stderr)
        return None


def search_album_meta(album: str, artist: str = "", titles: list[str] | None = None,
                      source_hint: str = "") -> dict:
    """检索专辑官方元信息。返回 {"found": bool, "staff": {...}, "购买": "", "发布": ""}；
    请求失败抛 LLMError。source_hint 来自音频 tag（如「@厂牌 dizzylab.net」），
    用于把检索导向正确的发行平台。"""
    artist_hint = f"（创作者/歌手：{artist}）" if artist else ""
    titles_hint = f"参考曲目：{'、'.join(titles)}\n" if titles else ""
    source_hint_line = f"来源线索（来自音频文件内嵌 tag）：{source_hint}\n" if source_hint else ""
    resp = _llm.search_chat(
        ALBUM_PROMPT.format(album=album, artist_hint=artist_hint,
                            titles_hint=titles_hint, source_hint_line=source_hint_line))
    data = _llm.extract_json(resp)
    return data if isinstance(data, dict) else {"found": False}
