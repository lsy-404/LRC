"""fetch_bilibili_meta.py — 从 Bilibili 搜索补全缺失的专辑元数据

策略
────
1. 读取各专辑 meta.toml，找出缺失关键字段的专辑
2. 构造多个搜索词（优先"中文名+专辑/试听"），在 Bilibili 搜索
3. 评分排序：
   - 标题含试听/PV/专辑等宣发词 → 大幅加分
   - 标题/简介 含专辑名 → 加分
   - author 与已知出品方匹配 → 加分
   - 若首轮无高分命中，用 "{UP主名} {专辑名} 专辑" 再搜一轮
4. 选定视频后（自动或交互），拉取视频详情：
   - 简介 (desc) 与前几条热门评论 → 返回原始文本，由人工判断
   - 脚本从中用正则预提取购买/淘宝/Dizzylab 链接，仅作建议
5. 交互确认后写入 meta.toml（仅填充空字段）

用法
────
python .github/scripts/fetch_bilibili_meta.py --album "视星等4.44"
python .github/scripts/fetch_bilibili_meta.py --auto --fields release,year
python .github/scripts/fetch_bilibili_meta.py --search-only
python .github/scripts/fetch_bilibili_meta.py --dry-run
"""

from __future__ import annotations

import argparse
import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

# Windows UTF-8 输出
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from lib.config_loader import load_config
from lib.meta_parser import load_album_meta

CONFIG = load_config()
PROJECT = CONFIG.get("project", {})
META_CONFIG = CONFIG.get("meta", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))

# ──────────────────────────────────────────────────────────────────────────────
# Bilibili API helpers
# ──────────────────────────────────────────────────────────────────────────────

_SEARCH_URL  = "https://api.bilibili.com/x/web-interface/search/all/v2"
_VIEW_URL    = "https://api.bilibili.com/x/web-interface/view"
_REPLY_URL   = "https://api.bilibili.com/x/v2/reply"
_VIDEO_BASE  = "https://www.bilibili.com/video/"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 宣发关键词（标题中出现则大幅加分）
_PROMO_TITLE_KW = ["试听", "试听pv", "pv", "宣传片", "宣传", "预告", "正式发布", "发售", "专辑", "ep"]
# 普通关键词（标题中出现则小幅加分）
_PROMO_MINOR_KW = ["mv", "full", "完整版", "收录曲"]
# 二创/翻唱关键词（标题中出现则扣分，不区分大小写）
_COVER_PENALTY_KW = ["remix", "翻唱", "翻调", "cover", "翻奏", "重编曲", "amv", "mmd", "人力"]
_COVER_PENALTY_RE = re.compile(
    r'(?:remix|翻唱|翻调|cover|翻奏|重编曲|amv|mmd|人力)', re.IGNORECASE
)


def _clean_html(text: str) -> str:
    text = re.sub(r'<em class="keyword">(.*?)</em>', r"\1", text)
    return html.unescape(text).strip()


def _bili_get(url: str, referer: str = "https://www.bilibili.com") -> Optional[dict]:
    """发起 GET 请求，返回解析好的 JSON dict，失败返回 None。"""
    headers = {**_HEADERS, "Referer": referer}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [WARN] 请求失败 {url}: {e}", file=sys.stderr)
        return None


def search_bilibili(keyword: str, page_size: int = 10) -> list[dict[str, Any]]:
    """全站搜索视频，返回标准化列表。"""
    params = urllib.parse.urlencode({
        "keyword": keyword,
        "search_type": "video",
        "page": 1,
        "pagesize": page_size,
    })
    data = _bili_get(f"{_SEARCH_URL}?{params}")
    if not data or data.get("code") != 0:
        return []

    videos: list[dict[str, Any]] = []
    for section in data.get("data", {}).get("result", []):
        if not isinstance(section, dict) or section.get("result_type") != "video":
            continue
        for v in section.get("data", []):
            bvid = v.get("bvid", "")
            if not bvid:
                continue
            pubdate = v.get("pubdate", 0)
            videos.append({
                "title":       _clean_html(v.get("title", "")),
                "bvid":        bvid,
                "url":         f"{_VIDEO_BASE}{bvid}",
                "pubdate":     pubdate,
                "date_str":    datetime.fromtimestamp(pubdate).strftime("%Y-%m-%d") if pubdate else "",
                "author":      v.get("author", ""),
                "author_mid":  str(v.get("mid", "")),
                "tag":         _clean_html(v.get("tag", "")),
                "description": _clean_html(v.get("description", "")),
                "play":        v.get("play", 0),
                # 详情字段（延迟加载）
                "detail_desc":     None,
                "detail_aid":      None,
            })
    return videos


def fetch_video_detail(bvid: str) -> dict[str, Any]:
    """拉取视频详情，返回 {desc, aid, owner_name, owner_mid}。"""
    data = _bili_get(f"{_VIEW_URL}?bvid={bvid}")
    if not data or data.get("code") != 0:
        return {}
    info = data.get("data", {})
    return {
        "desc":       info.get("desc", ""),
        "aid":        info.get("aid", 0),
        "owner_name": info.get("owner", {}).get("name", ""),
        "owner_mid":  info.get("owner", {}).get("mid", 0),
        "pubdate":    info.get("pubdate", 0),
    }


def fetch_top_comments(aid: int, n: int = 5) -> list[str]:
    """拉取视频热门评论，返回纯文本列表。"""
    params = urllib.parse.urlencode({"type": 1, "oid": aid, "pn": 1, "ps": n, "sort": 2})
    data = _bili_get(f"{_REPLY_URL}?{params}")
    if not data or data.get("code") != 0:
        return []
    replies = data.get("data", {}).get("replies") or []
    return [r.get("content", {}).get("message", "") for r in replies if r]


def search_up_videos(owner_name: str, score_name: str, page_size: int = 10) -> list[dict[str, Any]]:
    """用 '{UP主名} {专辑名} 专辑 试听' 在全站搜索，用于二次检索。"""
    query = f"{owner_name} {score_name} 专辑 试听"
    time.sleep(0.4)
    return search_bilibili(query, page_size=page_size)


# ──────────────────────────────────────────────────────────────────────────────
# 链接提取（从简介/评论原文中用正则预提取建议值）
# ──────────────────────────────────────────────────────────────────────────────

_TB_RE  = re.compile(r'https?://(?:item\.taobao\.com|m\.tb\.cn|tb\.cn|e\.tb\.cn)[^\s\u3000\]）)]+')
_DZ_RE  = re.compile(r'https?://(?:www\.)?dizzylab\.net[^\s\u3000\]）)]+')
_BLI_RE = re.compile(r'https?://(?:www\.)?bilibili\.com/video/[A-Za-z0-9]+/?')


def extract_links_from_text(text: str) -> dict[str, list[str]]:
    """从文本中提取各类链接，返回 {tb: [...], dz: [...], bili: [...]}。"""
    return {
        "tb":   _TB_RE.findall(text),
        "dz":   _DZ_RE.findall(text),
        "bili": _BLI_RE.findall(text),
    }


# ──────────────────────────────────────────────────────────────────────────────
# 评分
# ──────────────────────────────────────────────────────────────────────────────

def score_video(
    video: dict[str, Any],
    score_name: str,
    known_producers: list[str] | None = None,
) -> float:
    """
    计算视频与专辑的相关度分数（0~1）。

    权重设计：
      - 标题含 '试听' / 'PV' 等宣发词：+0.30（首位优先）
      - 标题完整包含专辑名：+0.40
      - 标题分词匹配（中文段 ≥2字、英文段 ≥3字）：+0.10 / 词段
      - 标签/简介含专辑名：+0.08
      - author 在已知出品方列表中：+0.20
      - 次要宣发词（MV/完整版）：+0.05
    """
    title  = video.get("title", "")
    title_l = title.lower()
    tag    = video.get("tag", "").lower()
    desc   = video.get("description", "").lower()
    author = video.get("author", "")
    name_l = score_name.lower()

    score = 0.0

    # 宣发词（标题）— "发售pv" 组合额外加分
    for kw in _PROMO_TITLE_KW:
        if kw in title_l:
            score += 0.30
            break
    if "发售" in title_l and "pv" in title_l:
        score += 0.20  # 发售PV 是最符合"专辑发布"语义的视频类型
    if "全专" in title_l:
        score += 0.20  # 全专试听/全专PV → 明确指向完整专辑，而非单曲
    if re.search(r'tr\.?\s*\d+', title_l):
        score -= 0.15  # 单曲轨道编号（Tr.12 等），非专辑PV
    for kw in _PROMO_MINOR_KW:
        if kw in title_l:
            score += 0.05
            break

    # 专辑名完整匹配
    if name_l in title_l:
        score += 0.40

    # 分词匹配
    for part in re.findall(r'[\u4e00-\u9fff]+', score_name):
        if len(part) >= 2 and part in title_l:
            score += 0.10
    for part in re.findall(r'[a-zA-Z]+', score_name):
        if len(part) >= 3 and part.lower() in title_l:
            score += 0.08

    # 标签/简介
    if name_l in tag or name_l in desc:
        score += 0.08

    # 二创/翻唱降分（使用 re 忽略大小写，也能匹配括号内容）
    if _COVER_PENALTY_RE.search(title):
        score -= 0.20

    # 已知出品方 UP 主
    if known_producers:
        for prod in known_producers:
            if prod and prod in author:
                score += 0.20
                break

    return min(score, 1.0)


def find_best_match(
    videos: list[dict[str, Any]],
    score_name: str,
    known_producers: list[str] | None = None,
    min_score: float = 0.25,
) -> Optional[dict[str, Any]]:
    scored = sorted(
        [(score_video(v, score_name, known_producers), v) for v in videos],
        key=lambda x: x[0], reverse=True,
    )
    if scored and scored[0][0] >= min_score:
        return scored[0][1]
    return None


# ──────────────────────────────────────────────────────────────────────────────
# TOML 序列化
# ──────────────────────────────────────────────────────────────────────────────

FIELD_SCHEMA: list[tuple[str, str, str]] = [
    (str(item.get("internal", "")), str(item.get("toml_key", "")), str(item.get("type", "str")))
    for item in META_CONFIG.get("field_schema", [])
    if item.get("internal") and item.get("toml_key")
]


def _fmt_str(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def _fmt_list(values: list[str]) -> str:
    if not values:
        return "[]"
    return "[" + ", ".join(_fmt_str(v) for v in values) + "]"


def serialize_meta(meta: dict[str, Any]) -> str:
    lines: list[str] = []
    for internal, toml_key, typ in FIELD_SCHEMA:
        value = meta.get(internal)
        if typ == "list":
            lst = value if isinstance(value, list) else []
            lines.append(f"{toml_key} = {_fmt_list(lst)}")
        else:
            s = str(value) if value else ""
            lines.append(f"{toml_key} = {_fmt_str(s)}")
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# 搜索词构造
# ──────────────────────────────────────────────────────────────────────────────

def get_search_queries(album_dir: Path, meta: dict[str, Any]) -> list[str]:
    """构造搜索词列表（优先级从高到低）。"""
    zh_name  = str(meta.get("zh_name") or "").strip()
    en_name  = str(meta.get("en_name") or "").strip()
    suffix   = str(meta.get("suffix") or "").strip()
    folder   = album_dir.name

    seen: set[str] = set()
    result: list[str] = []

    def add(q: str) -> None:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            result.append(q)

    suf = suffix if suffix else ""
    # 1. 中文名 + 发售pv（专辑发售宣传片首位优先）
    if zh_name:
        add(f"{zh_name}{suf} 发售pv")
    # 2. 中文名 + 试听
    if zh_name:
        add(f"{zh_name}{suf} 试听")
    # 3. 中文名 + 专辑
    if zh_name:
        add(f"{zh_name}{suf} 专辑")
    # 3. 文件夹全名
    add(folder)
    # 4. 纯中文名
    if zh_name:
        add(f"{zh_name}{suf}")
    # 5. 纯英文名
    if en_name:
        add(f"{en_name} {suf}".strip())

    return result


def needs_fetch(meta: dict[str, Any]) -> dict[str, bool]:
    return {
        "release":  not str(meta.get("release") or "").strip(),
        "year":     not str(meta.get("year") or "").strip(),
        "produce":  not (meta.get("produce") or []),
        "purchase": not str(meta.get("purchase") or "").strip(),
        "electronic": not str(meta.get("electronic") or "").strip(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# 交互显示
# ──────────────────────────────────────────────────────────────────────────────

def display_videos(
    videos: list[dict[str, Any]],
    score_name: str,
    known_producers: list[str] | None = None,
    max_show: int = 5,
) -> None:
    print(f"\n  搜索结果（显示前 {min(max_show, len(videos))} / 共 {len(videos)} 个）：")
    for i, v in enumerate(videos[:max_show]):
        s = score_video(v, score_name, known_producers)
        marker = "★" if s >= 0.4 else ("◆" if s >= 0.25 else " ")
        print(f"  [{i+1}]{marker} {v['title'][:58]}")
        print(f"       {v['date_str']}  UP:{v['author']}  {v['url']}")


def prompt_select(videos: list[dict[str, Any]], max_show: int = 5) -> Optional[dict[str, Any]]:
    n = min(max_show, len(videos))
    prompt = f"  选择 [1-{n}] / [s] 跳过: "
    try:
        answer = input(prompt).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return None
    if answer.isdigit() and 1 <= int(answer) <= n:
        return videos[int(answer) - 1]
    return None


def _yn(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() == "y"
    except (EOFError, KeyboardInterrupt):
        return False


def prompt_field(label: str, suggested: str) -> str:
    """显示建议值，让用户确认或输入新值；回车采用建议值，'-' 清空。"""
    display = suggested[:80] if suggested else "(无建议)"
    try:
        ans = input(f"  {label} [{display}]: ").strip()
    except (EOFError, KeyboardInterrupt):
        return ""
    if ans == "-":
        return ""
    if ans == "":
        return suggested
    return ans


# ──────────────────────────────────────────────────────────────────────────────
# 深度信息面板：展示简介+评论，提取建议链接
# ──────────────────────────────────────────────────────────────────────────────

def show_detail_panel(video: dict[str, Any]) -> dict[str, Any]:
    """
    拉取选定视频的详情（简介+评论），打印原始文本供人工判断。
    返回预提取的建议值 dict：
      {desc, comments, suggested_purchase, suggested_electronic,
       suggested_produce, owner_name, owner_mid}
    """
    bvid = video["bvid"]
    print(f"\n  ── 拉取视频详情 {bvid} ──")
    detail = fetch_video_detail(bvid)
    if not detail:
        print("  [WARN] 详情拉取失败")
        return {}

    desc       = detail.get("desc", "")
    aid        = detail.get("aid", 0)
    owner_name = detail.get("owner_name", "")
    owner_mid  = detail.get("owner_mid", 0)

    # 更新 video 缓存
    video["detail_desc"] = desc
    video["detail_aid"]  = aid
    video["author"]      = owner_name  # 以详情为准

    # 拉取评论
    time.sleep(0.6)
    comments: list[str] = []
    if aid:
        comments = fetch_top_comments(aid, n=5)

    # ── 展示原始文本 ──────────────────────────────
    print(f"\n  ┌─ 视频简介 ({'有内容' if desc.strip() else '空'}) ─────────────────────────")
    if desc.strip():
        for line in desc.strip().splitlines()[:30]:
            print(f"  │ {line}")
    else:
        print("  │ （无简介）")
    print("  └───────────────────────────────────────────────")

    if comments:
        print(f"\n  ┌─ 热门评论（前 {len(comments)} 条）──────────────────────")
        for i, c in enumerate(comments, 1):
            for line in c.strip().splitlines()[:6]:
                print(f"  │[{i}] {line}")
            print("  │")
        print("  └───────────────────────────────────────────────")

    # ── 自动提取链接建议 ──────────────────────────
    all_text = desc + "\n" + "\n".join(comments)
    links = extract_links_from_text(all_text)

    suggested_purchase   = links["tb"][0]  if links["tb"]  else ""
    suggested_electronic = links["dz"][0]  if links["dz"]  else ""

    if suggested_purchase or suggested_electronic:
        print("\n  ── 链接提取建议 ──")
        if suggested_purchase:
            print(f"  淘宝: {suggested_purchase}")
        if suggested_electronic:
            print(f"  Dizzylab: {suggested_electronic}")

    return {
        "desc":                 desc,
        "comments":             comments,
        "suggested_purchase":   suggested_purchase,
        "suggested_electronic": suggested_electronic,
        "owner_name":           owner_name,
        "owner_mid":            owner_mid,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 处理单张专辑
# ──────────────────────────────────────────────────────────────────────────────

def process_album(
    album_dir: Path,
    dry_run: bool = False,
    auto: bool = False,
    search_only: bool = False,
    verbose: bool = False,
    fields: Optional[list[str]] = None,
    deep: bool = True,
) -> bool:
    """
    处理单张专辑。
    deep=True：选定视频后拉取详情+评论，展示原始文本并交互补充更多字段。
    """
    album_name = album_dir.name
    meta, meta_path = load_album_meta(album_dir)

    needed = needs_fetch(meta)
    if fields:
        needed = {k: v for k, v in needed.items() if k in fields}
    if not any(needed.values()):
        if verbose:
            print(f"  [跳过] {album_name}（目标字段已齐全）")
        return False

    missing = [k for k, v in needed.items() if v]
    print(f"\n{'─'*62}")
    print(f"  专辑: {album_name}")
    print(f"  缺少: {', '.join(missing)}")

    zh_name = str(meta.get("zh_name") or "").strip()
    score_name = zh_name if zh_name else album_name
    known_producers: list[str] = []
    if isinstance(meta.get("produce"), list):
        known_producers = [str(p) for p in meta["produce"] if p]

    # ── 搜索（多轮合并去重）──────────────────────
    queries = get_search_queries(album_dir, meta)
    videos: list[dict[str, Any]] = []
    seen_bvids: set[str] = set()

    for i, q in enumerate(queries[:2]):
        if i > 0:
            time.sleep(0.45)
        print(f"  搜索: {q}")
        for v in search_bilibili(q, page_size=10):
            bvid = v.get("bvid", "")
            if bvid and bvid not in seen_bvids:
                seen_bvids.add(bvid)
                videos.append(v)

    if not videos:
        print("  [无结果] Bilibili 未返回视频")
        return False

    if search_only:
        display_videos(videos, score_name, known_producers)
        return False

    # ── 选择视频 ──────────────────────────────────
    if auto:
        selected = find_best_match(videos, score_name, known_producers)
        if not selected:
            print("  [跳过] 无高分匹配，尝试 UP 主二次搜索…")
            # 用评分最高者的 UP 主再搜一轮
            top = sorted(videos, key=lambda v: score_video(v, score_name, known_producers), reverse=True)
            if top:
                up2 = top[0]["author"]
                time.sleep(0.5)
                extra = search_up_videos(up2, score_name)
                for v in extra:
                    bvid = v.get("bvid", "")
                    if bvid and bvid not in seen_bvids:
                        seen_bvids.add(bvid)
                        videos.append(v)
                selected = find_best_match(videos, score_name, known_producers)
            if not selected:
                display_videos(videos, score_name, known_producers, max_show=3)
                return False
        print(f"  [自动] {selected['title'][:58]}")
        print(f"         {selected['date_str']}  UP:{selected['author']}  {selected['url']}")
    else:
        # 交互：若首轮无高分，提示并可二次搜索
        best_score = max((score_video(v, score_name, known_producers) for v in videos), default=0)
        if best_score < 0.25:
            print(f"  [提示] 当前最高评分 {best_score:.2f}，结果可能不准确")
            top = sorted(videos, key=lambda v: score_video(v, score_name, known_producers), reverse=True)
            if top and _yn("  是否用该视频 UP 主再搜一轮？[y/N]: "):
                up2 = top[0]["author"]
                time.sleep(0.5)
                extra = search_up_videos(up2, score_name)
                for v in extra:
                    bvid = v.get("bvid", "")
                    if bvid and bvid not in seen_bvids:
                        seen_bvids.add(bvid)
                        videos.append(v)
                print(f"  二次搜索追加 {len(extra)} 条（去重后共 {len(videos)} 条）")
        display_videos(videos, score_name, known_producers)
        selected = prompt_select(videos)
        if not selected:
            print("  [跳过]")
            return False

    # ── 深度面板：展示简介+评论 ──────────────────
    panel: dict[str, Any] = {}
    if deep and not auto:
        panel = show_detail_panel(selected)
    elif deep and auto:
        # 自动模式仍拉取详情，但只提取链接不展示
        time.sleep(0.5)
        detail = fetch_video_detail(selected["bvid"])
        if detail:
            selected["author"] = detail.get("owner_name", selected["author"])
            selected["detail_aid"] = detail.get("aid", 0)
            desc = detail.get("desc", "")
            aid  = detail.get("aid", 0)
            time.sleep(0.5)
            comments = fetch_top_comments(aid, n=5) if aid else []
            all_text = desc + "\n" + "\n".join(comments)
            links = extract_links_from_text(all_text)
            panel = {
                "desc": desc,
                "comments": comments,
                "suggested_purchase":   links["tb"][0]  if links["tb"]  else "",
                "suggested_electronic": links["dz"][0]  if links["dz"]  else "",
                "owner_name": selected["author"],
                "owner_mid":  detail.get("owner_mid", 0),
            }

    # ── 构建变更 ────────────────────────────────
    new_meta = dict(meta)
    changes: list[str] = []

    def apply(internal: str, toml_key: str, value: str) -> None:
        if value and needed.get(internal):
            new_meta[internal] = value
            changes.append(f"{toml_key} = {value}")

    # release
    if needed.get("release"):
        apply("release", "发布", f"[Bilibili]({selected['url']})")

    # year
    if needed.get("year") and selected.get("date_str"):
        apply("year", "发行日期", selected["date_str"])

    # purchase（自动模式：直接采用；交互模式：人工确认）
    if needed.get("purchase"):
        sugg = panel.get("suggested_purchase", "")
        if auto:
            if sugg:
                apply("purchase", "购买", sugg)
        else:
            val = prompt_field("购买链接", sugg)
            if val:
                apply("purchase", "购买", val)

    # electronic
    if needed.get("electronic"):
        sugg = panel.get("suggested_electronic", "")
        if auto:
            if sugg:
                apply("electronic", "电子", sugg)
        else:
            val = prompt_field("电子版链接", sugg)
            if val:
                apply("electronic", "电子", val)

    # produce（交互模式才提示；自动模式不假设 UP = 出品方）
    if needed.get("produce") and not auto:
        owner = panel.get("owner_name") or selected.get("author", "")
        if owner and _yn(f"\n  UP主「{owner}」设为出品方？[y/N]: "):
            new_meta["produce"] = [owner]
            changes.append(f"出品 = [{owner}]")

    if not changes:
        print("  [无更新] 无可填充字段")
        return False

    print(f"\n  变更：")
    for c in changes:
        print(f"    + {c}")

    if dry_run:
        print("  [DRY-RUN] 未写入")
        return True

    target = meta_path if meta_path else (album_dir / "meta.toml")
    target.write_text(serialize_meta(new_meta), encoding="utf-8")
    print(f"  [已写入] {target.relative_to(ROOT_DIR)}")
    return True


# ──────────────────────────────────────────────────────────────────────────────
# 主入口
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="从 Bilibili 搜索补全缺失的专辑元数据"
    )
    parser.add_argument("--album",      metavar="NAME",  help="仅处理指定专辑文件夹名")
    parser.add_argument("--dry-run",    action="store_true", help="预览但不写入")
    parser.add_argument("--auto",       action="store_true", help="自动选择，非交互")
    parser.add_argument("--search-only",action="store_true", help="仅搜索，不写入")
    parser.add_argument("--no-deep",    action="store_true", help="不拉取视频详情/评论")
    parser.add_argument("--verbose",    action="store_true", help="显示跳过专辑")
    parser.add_argument("--fields",     metavar="F1,F2",
                        help="仅处理指定字段（逗号分隔，可选: release,year,produce,purchase,electronic）")
    args = parser.parse_args()

    if not RES_DIR.exists():
        print(f"[ERROR] 找不到资源目录：{RES_DIR}", file=sys.stderr)
        sys.exit(1)

    target_fields: Optional[list[str]] = None
    if args.fields:
        target_fields = [f.strip() for f in args.fields.split(",") if f.strip()]

    if args.album:
        album_dirs = [RES_DIR / args.album]
        if not album_dirs[0].is_dir():
            print(f"[ERROR] 专辑目录不存在：{album_dirs[0]}", file=sys.stderr)
            sys.exit(1)
    else:
        album_dirs = sorted([d for d in RES_DIR.iterdir() if d.is_dir()])

    tags = []
    if args.dry_run:    tags.append("DRY-RUN")
    if args.auto:       tags.append("AUTO")
    if args.search_only: tags.append("SEARCH-ONLY")
    mode_str = f"[{'/'.join(tags)}] " if tags else ""
    print(f"{mode_str}开始处理 {len(album_dirs)} 张专辑…\n")

    updated = 0
    for album_dir in album_dirs:
        try:
            if process_album(
                album_dir,
                dry_run=args.dry_run,
                auto=args.auto,
                search_only=args.search_only,
                verbose=args.verbose,
                fields=target_fields,
                deep=not args.no_deep,
            ):
                updated += 1
        except KeyboardInterrupt:
            print("\n[中断]")
            break
        except Exception as e:
            print(f"\n  [ERROR] {album_dir.name}: {e}", file=sys.stderr)
            if args.verbose:
                import traceback; traceback.print_exc()

    print(f"\n{'─'*62}")
    action = "预览" if args.dry_run else ("搜索" if args.search_only else "已更新")
    print(f"完成。{len(album_dirs)} 张专辑，{updated} 张{action}。")


if __name__ == "__main__":
    main()
