#!/usr/bin/env python3
"""ingest/organize.py — 把摄取素材整理成 res/<专辑>/ 结构（含 STT×歌词强制对齐）。

输入素材（任意子集）：
- 逐曲歌词（来自歌词 txt，已解析为 {title, lines, staff}）→ 直接成轨，无需 LLM 分轨
- 歌词本文本（OCR 图片 / docx / pdf 抽取的合并文本，含歌词 + credits）→ 无逐曲歌词时由 LLM 分轨
- 专辑级 credits 文本（如 Staff表.txt）→ 抽 meta
- audio_words：{音频名: [{start,end,text}]}（faster-whisper 词级时间戳）
- manifest.toml：目标专辑名 + 可选 meta 覆盖
- cover_path：封面图

输出 res/<专辑>/：
- <序号> <曲名>.lrc：音频按覆盖率匹配到轨 → align 强制对齐成标准行级 timed LRC；
  无匹配音频则写无时间轴草稿
- <序号> <曲名>.klrc：同一次对齐的逐字增强版侧车文件（行内附 <字时间> 标签），
  仅在匹配到音频时才有；与 .lrc 分文件存放，不影响标准 LRC 播放器/解析器兼容性
- meta.toml：credits/staff 抽取 + manifest 覆盖
- cover.<ext>：若提供封面
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

if __package__ in (None, ""):
    from ingest import _llm, align as align_mod, authority_lrc as authority_mod, lyrics as lyrics_mod, websearch as web_mod  # type: ignore
else:
    from . import _llm, align as align_mod, authority_lrc as authority_mod, lyrics as lyrics_mod, websearch as web_mod

try:
    import tomllib  # py311+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None

from lib.config_loader import load_config

CONFIG = load_config()
_META = CONFIG.get("meta", {})
FIELD_SCHEMA: list[dict] = _META.get("field_schema", [])
INTERNAL_TO_TOML = {f["internal"]: f["toml_key"] for f in FIELD_SCHEMA}
INTERNAL_TYPE = {f["internal"]: f["type"] for f in FIELD_SCHEMA}
LIST_INTERNALS = [f["internal"] for f in FIELD_SCHEMA if f["type"] == "list"]
STR_INTERNALS = [f["internal"] for f in FIELD_SCHEMA if f["type"] == "str"]
NAME_FIELDS = [("prefix", "前缀"), ("zh_name", "中文名"), ("en_name", "英文名"), ("suffix", "后缀")]

# 音频↔轨匹配的最低字符覆盖率，低于此视为不匹配（→ 无时间轴草稿）
MATCH_THRESHOLD = 0.25
# 歌词本页↔轨候选的最低覆盖率（仅作 LLM 分配提示，阈值可比正式匹配宽）
PAGE_MATCH_THRESHOLD = 0.20

SINGLE_SUBMISSION_TYPE = "single"
SINGLE_ALBUM_NAME = "单曲"

ORGANIZE_SYSTEM = """你是音乐专辑歌词整理专家。给你一份专辑歌词本混合文本（可能含多首歌词及
作词/作曲/编曲/演唱/调校/混音/母带/曲绘/视频/策划等制作信息和发行/购买/出品等源信息）。
整理成结构化 JSON。

输出 JSON（只输出 JSON）：
{
  "album": "专辑名（能确定则填，否则空）",
  "meta": {"year":"","produce":[],"release":"","purchase":"","electronic":"",
           "vocal":[],"lyricist":[],"composer":[],"arranger":[],"tuning":[],"illustrator":[],
           "mixer":[],"mastering":[],"video":[],"planning":[]},
  "tracks": [{"order":1,"title":"曲名","lyrics":"逐行歌词，保留换行，不翻译不补全"}]
}
规则：1.只用文本真实信息，未知留空，勿臆造 2.vocal 只填虚拟歌姬/声库，不填真人或团体缩写
3.去掉人名 @用户名 后缀 4.tracks 按歌词本顺序编号。"""


# 中文/别名键 → internal（manifest 容错：若用户写了 quoted 中文键也能识别）
_KEY_ALIAS = dict(_META.get("mapping", {}))


def _normalize_manifest(m: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in (m or {}).items():
        out[_KEY_ALIAS.get(k, k)] = v
    return out


def _read_toml(path: Path) -> dict[str, Any]:
    if not path.is_file() or tomllib is None:
        return {}
    try:
        return _normalize_manifest(tomllib.loads(path.read_text(encoding="utf-8")))
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  manifest 解析失败 {path}: {e}", file=sys.stderr)
        return {}


def _as_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    s = str(v).strip()
    return [s] if s else []


def _has_cjk(s: str) -> bool:
    return any("一" <= c <= "鿿" for c in s)


def _sanitize_filename(name: str) -> str:
    bad = '<>:"/\\|?*'
    out = "".join("_" if c in bad else c for c in name).strip()
    return out or "untitled"


def _safe_album_name(name: Any, fallback: str = "untitled") -> str:
    """Albums are output directory basenames, never paths supplied by a review draft."""
    base = Path(str(name or "").replace("\\", "/")).name.strip()
    if not base or base in {".", ".."}:
        base = fallback
    return _sanitize_filename(base)


def is_single_submission(submission_type: Any) -> bool:
    """Whether a review draft is the isolated single-track submission type."""
    return str(submission_type or "").strip().casefold() == SINGLE_SUBMISSION_TYPE


def _output_basename(track: dict[str, Any], order: Any, *, include_order: bool = True) -> str:
    """Use a safe requested basename, or preserve the established order/title default."""
    preferred = track.get("final_name") if track.get("inst") else None
    raw = str(preferred or track.get("output_name") or "").strip()
    if raw:
        # Names are basenames only; ignore a pasted path and strip either accepted sidecar suffix.
        base = Path(raw.replace("\\", "/")).name
        while base.lower().endswith((".lrc", ".klrc")):
            suffix_len = 5 if base.lower().endswith(".klrc") else 4
            base = base[:-suffix_len]
        if base not in {"", ".", ".."}:
            return _sanitize_filename(base)
    title = _sanitize_filename(str(track.get("title", "")).strip() or f"track{order}")
    return f"{order} {title}" if include_order else title


# 伴奏/无人声轨识别：分隔符包裹匹配，避免误伤 "Inspire"/"Instant" 这类词内含 ins
# 的正常曲名（与上传页 UploadBox.vue 的 INST_RE 同一套启发式，前后端保持一致）
_INST_RE = re.compile(r"(?:^|[\s._()\[\]-])(?:inst(?:rumental)?|ins|off[\s_-]?vocal)(?:[\s._()\[\]-]|$)", re.I)
_INST_CJK_RE = re.compile(r"伴奏|无人声")

# OCR 段落标记（ocr.py 让模型加 [LYRICS]/[CREDITS] 作分区提示）：给 LLM 分配用可留在
# booklet_text，但绝不能混进最终歌词行——独占一行的标记整行剥掉
_SECTION_MARKER_RE = re.compile(r"^\s*\[(?:CREDITS|LYRICS|NO_TEXT)\]\s*$", re.I)


def _is_inst_filename(name: str) -> bool:
    stem = Path(name).stem
    return bool(_INST_RE.search(stem) or _INST_CJK_RE.search(stem))


def _strip_inst_markers(title: str) -> str:
    """去掉 inst/伴奏 等标记及紧邻分隔符，得到用于同名曲目匹配的基础曲名。"""
    s = _INST_RE.sub(" ", title)
    s = _INST_CJK_RE.sub(" ", s)
    return re.sub(r"[\s._()\[\]-]+", " ", s).strip()


def _join_words(tokens: list[str]) -> str:
    """词列表 → 行字符串：CJK 字符之间直连，非 CJK 之间加空格。"""
    if not tokens:
        return ""
    out = tokens[0]
    for t in tokens[1:]:
        if _has_cjk(out[-1:]) or _has_cjk(t[:1]):
            out += t
        else:
            out += " " + t
    return out.strip()


def _words_to_lines(words: list[dict]) -> list[str]:
    """单曲 STT 词流 → 分行文本。

    分行策略（优先级从高到低）：
    1. stt.py 标注的 seg_end（Whisper segment 边界）→ 强制断行
    2. 静音间隔超阈值（CJK 0.4 s / 其他 1.0 s）
    3. 行时长超 6 s 或 CJK 字数超 20
    CJK tokens 直连不加空格。
    """
    lines: list[str] = []
    buf: list[str] = []
    buf_start = 0.0
    prev_end = 0.0

    def _flush() -> None:
        line = _join_words(buf)
        if line:
            lines.append(line)
        buf.clear()

    for w in words:
        w_start = float(w.get("start", 0.0))
        w_end = float(w.get("end", w_start))
        gap = w_start - prev_end
        text = (w.get("text") or "").strip()
        is_cjk_word = _has_cjk(text)
        gap_thresh = 0.4 if is_cjk_word else 1.0
        duration = w_start - buf_start if buf else 0.0
        cjk_len = sum(1 for t in buf for c in t if "一" <= c <= "鿿")

        if buf and (gap >= gap_thresh or duration >= 6.0 or cjk_len >= 20):
            _flush()

        if text:
            if not buf:
                buf_start = w_start
            buf.append(text)
        prev_end = w_end

        # seg_end 在当前词加入后断行（保证当前词归入本行）
        if w.get("seg_end") and buf:
            _flush()

    _flush()
    return lines


def _words_to_tracks(audio_words: dict[str, list]) -> list[dict]:
    """STT 词流 → 轨道列表（无歌词文本/无轨单时的通用兜底）。"""
    tracks: list[dict] = []
    for i, (audio_name, words) in enumerate(sorted(audio_words.items()), 1):
        if not words:
            continue
        lines = _words_to_lines(words)
        stem = Path(audio_name).stem
        order = _order_from_name(stem)
        title_m = re.match(r"^\d+[\s._-]+(.*)", stem)
        title = title_m.group(1).strip() if title_m and title_m.group(1).strip() else stem
        tracks.append({"order": order or i, "title": title or stem, "lines": lines, "staff": {}})
    return tracks


# ──────────────────────────────────────────────────────────────────────────────
# LLM 分轨（仅当没有逐曲歌词时）
# ──────────────────────────────────────────────────────────────────────────────
ORDER_SYSTEM = """你是音乐专辑整理助手。给你投稿目录中的音频文件名列表，产出专辑轨单。
规则：
1. 伴奏/instrumental/无人声版本（文件名含 INST/instrumental/off vocal/伴奏/无人声 等）
   不剔除，正常保留在轨单里，并在该曲对象加 "inst": true；其余曲目不加此字段
2. 按文件名中的曲序号排序，并重新编号为连续的 1..N
3. title 取歌曲本身名称：去掉序号前缀与结尾句号/多余空白，保留歌名内的标点；
   "inst": true 的曲目保留文件名里的 INST/伴奏 等标记原样，不要清理掉
4. file 必须是原文件名的逐字符原样
只输出 JSON：{"tracks":[{"order":1,"title":"...","file":"...","inst":false}]}"""


def llm_order_tracks(audio_names: list[str], album_hint: str = "") -> list[dict]:
    """音频文件名 → 权威轨单（歌曲本身名称优先）。失败抛 LLMError。

    伴奏/无人声轨的 inst 标记与 title 由文件名正则强制兜底（不依赖 LLM 是否听话），
    保证「保留文件名」这条规则始终成立。
    """
    user = "\n".join(audio_names)
    if album_hint:
        user = f"【专辑】{album_hint}\n{user}"
    resp = _llm.chat_auto(
        [{"role": "system", "content": ORDER_SYSTEM}, {"role": "user", "content": user}],
        kind="text",
    )
    plan = _llm.extract_json(resp)
    tracks = plan.get("tracks") if isinstance(plan, dict) else None
    valid = [t for t in (tracks or []) if t.get("file") in set(audio_names)]
    if not valid:
        raise _llm.LLMError("轨单编排返回无有效 tracks")
    for t in valid:
        file_name = str(t.get("file") or "")
        if not _is_inst_filename(file_name):
            continue
        t["inst"] = True
        t["title"] = _title_from_filename(file_name)
    return valid


def _title_from_filename(file_name: str) -> str:
    """文件名 → 保留标记的曲名（去掉开头曲序号，inst/伴奏 等标记原样保留）。"""
    stem = Path(file_name).stem
    m = re.match(r"^\d+[\s._-]+(.*)", stem)
    return (m.group(1) if m else stem).strip().strip("。.")


def apply_inst_overrides(tracks: list[dict], inst_marked: set, inst_as_song: set) -> None:
    """工作站显式标记（manifest 伴奏/原曲 键）覆盖文件名 inst 启发式，原地改。

    伴奏：强制 inst=True（用户在上传弹窗确认了这是伴奏轨）；
    原曲：摘掉 inst 标记（文件名启发式误伤，按正曲转写对齐）。
    在 llm_order_tracks 之后调用——优先级：显式标记 > 文件名正则 > LLM。
    """
    for t in tracks:
        name = Path(str(t.get("file") or "")).name
        if name in inst_marked and not t.get("inst"):
            t["inst"] = True
            t["title"] = _title_from_filename(name)
            print(f"  ○ 显式标记为伴奏: {name}", file=sys.stderr)
        elif name in inst_as_song and t.get("inst"):
            t["inst"] = False
            print(f"  ◉ 显式标记为原曲（推翻文件名启发式）: {name}", file=sys.stderr)


ASSIGN_SYSTEM = """你是音乐专辑歌词整理专家。给你专辑的权威轨单（来自音频文件，顺序与曲名
以此为准，不得增删改）和歌词本 OCR 混合文本（可能含歌词及作词/作曲/编曲/演唱/调校/混音/
母带/曲绘/视频/策划等制作信息和发行/购买/出品等源信息）。

歌词本按页给出，每页以「# === 文件名 (OCR/DOC) ===」开头，页头可能带注解：
- 【已绑定曲目 N. 曲名】：投稿者人工确认该页属于曲目 N，该页歌词只能分配给曲目 N，
  禁止分给其他曲目；
- 【疑似曲目 N. 曲名 (xx%) / ...】：机器按发音相似度给出的候选与置信度，仅供参考，
  与文本内容明显冲突时以内容为准。

任务：把歌词本中属于每一曲的文字原样分配给该曲，并抽出专辑级 meta。
输出 JSON（只输出 JSON）：
{
  "meta": {"year":"","produce":[],"release":"","purchase":"","electronic":"",
           "vocal":[],"lyricist":[],"composer":[],"arranger":[],"tuning":[],"illustrator":[],
           "mixer":[],"mastering":[],"video":[],"planning":[]},
  "assignments": {"1": "该曲歌词及其曲内staff行，保留换行", "2": "..."}
}
规则：1.assignments 的键 = 轨单 order 2.只用文本真实内容，找不到某曲的歌词就给空字符串，
勿臆造勿改写勿翻译 3.vocal 只填虚拟歌姬/声库 4.去掉人名 @用户名 后缀。"""


def _page_lyric_lines(text: str) -> list[str]:
    """页文本 → 剥离 staff 行后的歌词行（staff 行会稀释页↔轨覆盖率）。"""
    raw = [l for l in text.splitlines() if l.strip()]
    _, _, lyric_lines = lyrics_mod.split_staff_lines(raw)
    return lyric_lines


def link_orders_of(photo_links: dict[str, list[str] | str] | None, tracks_plan: list[dict]) -> dict[str, list[int]]:
    """manifest 绑定（图片名→音频名数组）→ {页文件名: 轨 order 数组}，basename 归一。"""
    by_file = {Path(str(t.get("file"))).name: t.get("order")
               for t in tracks_plan if t.get("file")}
    out: dict[str, list[int]] = {}
    for img, raw_audio in (photo_links or {}).items():
        audios = raw_audio if isinstance(raw_audio, list) else [raw_audio]
        orders = []
        for audio in audios:
            order = by_file.get(Path(str(audio)).name)
            if order and int(order) not in orders:
                orders.append(int(order))
            elif not order:
                print(f"  ⚠️  绑定目标不在轨单，忽略: {img} → {audio}", file=sys.stderr)
        if orders:
            out[Path(str(img)).name] = orders
    return out


def _vision_link_hints(photo_links: dict[str, list[str] | str] | None, tracks_plan: list[dict]) -> str:
    """人工绑定（图片→音频）→ 给视觉模型的强提示文本「图片名 → N. 曲名」。"""
    orders = link_orders_of(photo_links, tracks_plan)
    if not orders:
        return ""
    titles = {int(t.get("order") or 0): str(t.get("title", "")).strip() for t in tracks_plan}
    hints = []
    for img, values in orders.items():
        labels = ", ".join(f"{order}. {titles.get(order, '')}" for order in values)
        hints.append(f"{img} → {labels}")
    return "\n".join(hints)


def match_pages_to_tracks(
    pages: list[dict],
    tracks_plan: list[dict],
    audio_words: dict[str, list],
    audio_langs: dict[str, str] | None = None,
) -> dict[str, list[tuple[int, float]]]:
    """逐页×逐轨置信度：页歌词行对轨 STT 词流的覆盖率，≥阈值者为候选（降序，至多 3）。"""
    out: dict[str, list[tuple[int, float]]] = {}
    for pg in pages:
        lines = _page_lyric_lines(pg.get("text", ""))
        if not lines:
            continue
        scored: list[tuple[int, float]] = []
        for t in tracks_plan:
            words = audio_words.get(t.get("file"))
            if not words:
                continue
            lang = (audio_langs or {}).get(t.get("file"), "")
            cov = align_mod.coverage(lines, words, language=lang)
            if cov >= PAGE_MATCH_THRESHOLD:
                scored.append((int(t.get("order") or 0), cov))
        scored.sort(key=lambda x: -x[1])
        if scored:
            out[pg["name"]] = scored[:3]
    return out


def annotate_booklet(
    pages: list[dict],
    tracks_plan: list[dict],
    link_orders: dict[str, list[int]],
    candidates: dict[str, list[tuple[int, float]]],
) -> str:
    """逐页文本 + 绑定/候选注解 → 供 llm_assign_booklet 的歌词本文本。"""
    titles = {int(t.get("order") or 0): str(t.get("title", "")).strip() for t in tracks_plan}
    parts: list[str] = []
    for pg in pages:
        name = pg["name"]
        tag = ""
        if name in link_orders:
            orders = link_orders[name]
            label = '、'.join(f"{o}. {titles.get(o, '')}" for o in orders)
            tag = f" 【已绑定曲目 {label}】"
        elif name in candidates:
            hint = " / ".join(f"{o}. {titles.get(o, '')} ({cov:.0%})" for o, cov in candidates[name])
            tag = f" 【疑似曲目 {hint}】"
        parts.append(f"# === {name} ({pg.get('kind', 'OCR')}){tag} ===\n{pg.get('text', '')}")
    return "\n\n".join(parts)


def enforce_page_links(
    assignments: dict,
    pages: list[dict],
    tracks_plan: list[dict],
    link_orders: dict[str, list[int]],
    audio_words: dict[str, list],
    audio_langs: dict[str, str] | None = None,
) -> dict:
    """分配结果的确定性安全网（矫正前执行）：

    - 绑定轨：LLM 分配为空或对自身音频覆盖率过低 → 用绑定页原文回填（人工权威，不回退 STT）；
    - 非绑定轨：分配歌词对自身音频覆盖率低于 MATCH_THRESHOLD → 丢弃，回退该曲 STT 草稿。
    音频无词流（STT 失败）时无法评判，保持原分配。
    """
    page_text = {pg["name"]: pg.get("text", "") for pg in pages}
    linked_text: dict[int, list[str]] = {}
    for name in sorted(link_orders):
        for order in link_orders[name]:
            linked_text.setdefault(order, []).append(page_text.get(name, ""))
    out = dict(assignments)
    for t in tracks_plan:
        order = int(t.get("order") or 0)
        key = str(order)
        text = str(out.get(key) or "").strip()
        raw_linked = "\n".join(x for x in linked_text.get(order, []) if x.strip()).strip()
        words = audio_words.get(t.get("file"))
        lang = (audio_langs or {}).get(t.get("file"), "")
        cov = None
        if text and words:
            lines = _page_lyric_lines(text)
            cov = align_mod.coverage(lines, words, language=lang) if lines else 0.0
        if raw_linked:
            if not text:
                out[key] = raw_linked
                print(f"  🔗 曲目 {order}: LLM 未分配，采用绑定页原文", file=sys.stderr)
            elif cov is not None and cov < MATCH_THRESHOLD:
                out[key] = raw_linked
                print(f"  🔗 曲目 {order}: 分配覆盖率 {cov:.0%} 过低，改用绑定页原文", file=sys.stderr)
        elif text and cov is not None and cov < MATCH_THRESHOLD:
            out[key] = ""
            print(f"  ✂ 曲目 {order}: 分配歌词覆盖率 {cov:.0%} 低于阈值，回退 STT 草稿", file=sys.stderr)
    return out


def llm_assign_booklet(booklet_text: str, tracks_plan: list[dict]) -> dict:
    """歌词本文本按权威轨单分配歌词+抽 meta。失败抛 LLMError。"""
    track_list = "\n".join(f'{t.get("order")}. {t.get("title", "")}' for t in tracks_plan)
    user = f"【轨单】\n{track_list}\n\n【歌词本文本】\n{booklet_text.strip()}"
    resp = _llm.chat_auto(
        [{"role": "system", "content": ASSIGN_SYSTEM}, {"role": "user", "content": user}],
        kind="text",
    )
    data = _llm.extract_json(resp)
    if not isinstance(data, dict):
        raise _llm.LLMError("歌词分配返回无法解析")
    return data


def llm_split_booklet(source_text: str, album_hint: str) -> dict:
    """歌词本文本 → 分轨 plan。失败直接抛 LLMError，不降级不伪造。"""
    user = source_text.strip()
    if album_hint:
        user = f"【目标专辑】{album_hint}\n\n{user}"
    resp = _llm.chat_auto(
        [{"role": "system", "content": ORGANIZE_SYSTEM}, {"role": "user", "content": user}],
        kind="text",
    )
    plan = _llm.extract_json(resp)
    if not isinstance(plan, dict) or not plan.get("tracks"):
        raise _llm.LLMError("分轨返回无有效 tracks")
    return plan


# ──────────────────────────────────────────────────────────────────────────────
# 视觉分轨（去 OCR 转录）：多模态模型(gpt-5.6-luna)直接吃图片，一步出分配+meta+置信度
# ──────────────────────────────────────────────────────────────────────────────
ASSIGN_VISION_SYSTEM = """你是音乐专辑歌词整理专家。给你专辑的**权威轨单**（来自音频文件，顺序与
曲名以此为准，不得增删改）和**歌词本图片**（按顺序给出，每图前标注文件名；可能含多首歌词及
作词/作曲/编曲/演唱/调校/混音/母带/曲绘/视频/策划等制作信息与发行/购买/出品等源信息）。

请**直接看图**完成，不要先转录再分配：
1. 把每一曲的歌词从图片中原样识别并分配给对应曲目——歌词跨页、credits 混在歌词页都要正确
   处理；你可以自由参照任意页，不受任何单页限制。
2. 抽取专辑级 meta。
3. 给出每一曲的**置信度**（0~1，你对该曲歌词识别与归属的把握，低置信交人工重点校对）。
4. 顺带给出每页的**纯转录文本**（供人工对照参考）。

若用户给了「绑定提示」（某图属于某曲），那是**强提示**、优先参考，但**不是硬约束**——与图片
实际内容明显冲突时以内容为准。

输出 JSON（只输出 JSON）：
{
  "meta": {"year":"","produce":[],"release":"","purchase":"","electronic":"",
           "vocal":[],"lyricist":[],"composer":[],"arranger":[],"tuning":[],"illustrator":[],
           "mixer":[],"mastering":[],"video":[],"planning":[]},
  "assignments": {"1":"该曲逐行歌词，保留换行", "2":"..."},
  "confidence": {"1":0.95, "2":0.6},
  "pages": [{"name":"图片文件名","text":"该页纯转录"}]
}
规则：1.assignments 键=轨单 order 2.只用图片真实内容，找不到某曲歌词给空字符串，勿臆造勿翻译
3.vocal 只填虚拟歌姬/声库，不填真人或团体缩写 4.去掉人名 @用户名 后缀
5.输出统一简体中文（印刷体繁体/异体转对应简体，是字形转换非改写）。"""

_IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
             ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
             ".tiff": "image/tiff", ".tif": "image/tiff"}


def llm_assign_booklet_vision(image_paths: list[Path], tracks_plan: list[dict],
                              link_hints: str = "") -> dict:
    """多模态直接看歌词本图片，按权威轨单分配歌词 + 抽 meta + 每轨置信度 + 每页转录。

    去独立 OCR 转录：一次性全带整本（图作稳定前缀、detail 一致），模型自主跨页整合；
    人工绑定作强提示非硬锁。返回 {meta, assignments, confidence, pages}；失败抛 LLMError。
    """
    track_list = "\n".join(f'{t.get("order")}. {t.get("title", "")}' for t in tracks_plan)
    text = f"【权威轨单】\n{track_list}\n"
    if link_hints:
        text += f"\n【绑定提示（强提示，非硬约束）】\n{link_hints}\n"
    text += "\n【歌词本图片（按顺序，每图前标文件名）】"
    content: list[dict] = [{"type": "text", "text": text}]
    for p in image_paths:
        mime = _IMG_MIME.get(p.suffix.lower(), "image/jpeg")
        data_url = _llm.encode_image_bytes_data_url(p.read_bytes(), mime)
        content.append({"type": "text", "text": f"# {p.name}"})
        content.append({"type": "image_url", "image_url": {"url": data_url, "detail": "high"}})
    resp = _llm.chat_auto(
        [{"role": "system", "content": ASSIGN_VISION_SYSTEM}, {"role": "user", "content": content}],
        kind="vision",
    )
    data = _llm.extract_json(resp)
    if not isinstance(data, dict):
        raise _llm.LLMError("视觉分轨返回无法解析")
    return data


# ──────────────────────────────────────────────────────────────────────────────
# meta 合并与渲染
# ──────────────────────────────────────────────────────────────────────────────
def merge_meta(*sources: dict) -> dict[str, Any]:
    """按顺序合并 meta（前者优先）。每个 source 用 internal 键。"""
    merged: dict[str, Any] = {}
    for internal in LIST_INTERNALS:
        vals: list[str] = []
        for src in sources:
            vals = _as_list((src or {}).get(internal))
            if vals:
                break
        merged[internal] = vals
    for internal in STR_INTERNALS:
        val = ""
        for src in sources:
            val = str((src or {}).get(internal, "") or "").strip()
            if val:
                break
        merged[internal] = val
    return merged


def ensure_lyric_maker(meta: dict[str, Any], required: str = "武乙凌薇") -> dict[str, Any]:
    """Normalize album timing credits and append the required contributor when absent."""
    seen: set[str] = set()
    makers: list[str] = []
    for item in _as_list((meta or {}).get("lyric_maker")):
        if item not in seen:
            seen.add(item)
            makers.append(item)
    if required and required not in seen:
        makers.append(required)
    meta["lyric_maker"] = makers
    return meta


def _fmt_toml_value(value: Any, is_list: bool) -> str:
    if is_list:
        return "[" + ", ".join(f'"{v}"' for v in value) + "]"
    return f'"{value}"'


_NAME_INTERNALS = {k for k, _ in NAME_FIELDS}


def render_meta_toml(meta: dict[str, Any], names: dict[str, str]) -> str:
    """生成 meta.toml。名称字段(前缀/中文名/英文名/后缀)取自 names；其余取自 meta。

    注意：真实 config.toml 的 field_schema **已包含**名称字段，DEFAULT_CONFIG 没有。
    若 schema 已含名称字段，就在循环里用 names 值输出（避免与特判重复）；
    否则在「出品」后补一组（兼容 DEFAULT_CONFIG）。
    """
    lines: list[str] = []
    schema_has_names = any(f["internal"] in _NAME_INTERNALS for f in FIELD_SCHEMA)
    emitted_names = False
    for f in FIELD_SCHEMA:
        internal, toml_key = f["internal"], f["toml_key"]
        if internal in _NAME_INTERNALS:
            lines.append(f'{toml_key} = "{names.get(internal, "")}"')
            emitted_names = True
            continue
        is_list = f["type"] == "list"
        lines.append(f"{toml_key} = {_fmt_toml_value(meta.get(internal, [] if is_list else ''), is_list)}")
        if internal == "produce" and not schema_has_names and not emitted_names:
            for key, label in NAME_FIELDS:
                lines.append(f'{label} = "{names.get(key, "")}"')
            emitted_names = True
    if not emitted_names:
        for key, label in NAME_FIELDS:
            lines.append(f'{label} = "{names.get(key, "")}"')
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# 音频 ↔ 轨匹配 + 对齐
# ──────────────────────────────────────────────────────────────────────────────
def match_audio_to_track(
    track_lines: list[str],
    audio_words: dict[str, list],
    used: set,
    audio_langs: dict[str, str] | None = None,
) -> Optional[str]:
    """在未使用的音频里选与该轨歌词覆盖率最高者；低于阈值返回 None。"""
    best, best_cov = None, MATCH_THRESHOLD
    for name, words in audio_words.items():
        if name in used:
            continue
        lang = (audio_langs or {}).get(name, "")
        cov = align_mod.coverage(track_lines, words, language=lang)
        if cov >= best_cov:
            best, best_cov = name, cov
    return best


# 正文 credit 行的规范顺序（站点 row_field_alias 只认单标签行；前 7 个是
# 站点 list_fields 解析字段，其余为展示性补充）
_ROW_ORDER = [("vocal", "演唱"), ("lyricist", "作词"), ("composer", "作曲"),
              ("arranger", "编曲"), ("tuning", "调校"), ("illustrator", "曲绘"),
              ("mixer", "混音"), ("mastering", "母带"), ("video", "视频"),
              ("planning", "策划")]


def _credit_rows(staff: dict, album_meta: dict | None) -> list[str]:
    """生成规范单标签 credit 行：轨级 staff 优先，专辑 meta 兜底，空字段不输出。"""
    rows: list[str] = []
    for internal, label in _ROW_ORDER:
        names = [str(n) for n in (staff.get(internal) or []) if str(n).strip()]
        if not names:
            names = [str(n) for n in ((album_meta or {}).get(internal) or []) if str(n).strip()]
        if names:
            rows.append(f"{label}：{'/'.join(names)}")
    return rows


def build_track_lrc(
    track: dict,
    album: str,
    audio_words: dict[str, list],
    used: set,
    audio_langs: dict[str, str] | None = None,
    by: str = "",
    album_meta: dict | None = None,
) -> tuple[str, float, Optional[str]]:
    """为一轨生成 LRC：能匹配音频→对齐(timed)，否则无时间轴草稿。

    返回 (lrc, 覆盖率, lrc_words)。lrc 是标准行级 LRC（不含逐字标签，
    保证任何播放器/解析器兼容）；lrc_words 是同一份对齐结果的逐字增强版
    （行内 <字时间> 标签），另存 .klrc 侧车文件，不匹配音频时为 None。

    副作用：把匹配到的音频名写回 track["audio"]（未匹配为 ""），空标题由音频
    文件名回填，歌词本无文本时 STT 草稿行写回 track["lines"]。
    """
    title = str(track.get("title", "")).strip()
    lines = track.get("lines") or [l for l in str(track.get("lyrics", "")).splitlines() if l.strip()]
    staff = track.get("staff") or {}
    # 规范行由合并数据生成（歌词本原样行的复合标签站点解析不了，其信息已
    # 经 split_staff_lines 进入 staff/meta，不再原样透传）
    credits = _credit_rows(staff, album_meta)
    artist = "/".join(staff.get("vocal") or (album_meta or {}).get("vocal") or [])
    if track.get("inst"):
        # 伴奏/无人声轨：没有人声可自行转写对齐（不模糊匹配到别的音频）。有同名
        # 正曲则借正曲的音频词流对同一份歌词重新 align——输入（歌词+词流）与正曲
        # 完全相同，结果时间轴也完全一致，即"cv 正曲"；没有同名正曲则给一句
        # 「纯音乐，请欣赏」占位，不留死气沉沉的空文件也不臆造歌词
        pair_file = track.get("_pair_file")
        pair_words = (audio_words or {}).get(pair_file) if pair_file else None
        if pair_words and lines:
            pair_lang = (audio_langs or {}).get(pair_file, "")
            if lyrics_mod.is_chinese_language(pair_lang):
                lines = [lyrics_mod.to_simplified(l) for l in lines]
                credits = [lyrics_mod.to_simplified(c) for c in credits]
            lrc = align_mod.align(
                lines, pair_words, title=title, album=album, artist=artist, by=by,
                credits=credits, language=pair_lang,
            )
            lrc_words = align_mod.align(
                lines, pair_words, title=title, album=album, artist=artist, by=by,
                credits=credits, language=pair_lang, per_char=True,
            )
            cov = align_mod.coverage(lines, pair_words, language=pair_lang)
            track["audio"] = pair_file
            print(f"  ♫ {title}: 伴奏/无人声轨，时间轴完全 cv 同名正曲", file=sys.stderr)
            return (lyrics_mod.to_simplified(lrc), cov, lyrics_mod.to_simplified(lrc_words)) \
                if lyrics_mod.is_chinese_language(pair_lang) else (lrc, cov, lrc_words)
        header = f"[ti:{title}]\n[al:{album}]\n[ar:{artist}]\n[by:{by}]\n\n"
        if credits:
            header += "\n".join(credits) + "\n\n"
        track["audio"] = ""
        print(f"  ○ {title}: 伴奏/无人声轨，无同名曲目可复用，写纯音乐占位行", file=sys.stderr)
        return header + "[00:01.00]纯音乐，请欣赏\n", 0.0, None
    # 轨单路径：轨即音频，直连不做模糊匹配；否则按歌词相似度匹配
    audio = track.get("file") if track.get("file") in (audio_words or {}) else (
        match_audio_to_track(lines, audio_words, used, audio_langs) if audio_words else None)
    if audio:
        used.add(audio)
        track["audio"] = audio
        if not lines:
            # 歌词本没有该曲文本：用它自身 STT 词流出草稿行（曲名仍来自轨单）
            lines = _words_to_lines(audio_words[audio])
            track["lines"] = list(lines)  # 回写供人工闸门编辑
            print(f"  ⟳ {title or audio}: 歌词本无此曲文本，STT 草稿", file=sys.stderr)
        if not title:
            # 音频文件名自带曲名（投稿者命名/内嵌tag），比 OCR 读出的标题可靠
            stem = Path(audio).stem
            m = re.match(r"^\d+[\s._-]+(.*)", stem)
            title = (m.group(1) if m else stem).strip().strip("。.")
            track["title"] = title
        lang = (audio_langs or {}).get(audio, "")
        if lyrics_mod.is_chinese_language(lang):
            # 站点数据规范为简体；whisper 转写与偶发的 OCR 不服从都在此统一转换
            lines = [lyrics_mod.to_simplified(l) for l in lines]
            credits = [lyrics_mod.to_simplified(c) for c in credits]
        lrc = align_mod.align(
            lines, audio_words[audio], title=title, album=album, artist=artist, by=by,
            credits=credits, language=lang,
        )
        lrc_words = align_mod.align(
            lines, audio_words[audio], title=title, album=album, artist=artist, by=by,
            credits=credits, language=lang, per_char=True,
        )
        cov = align_mod.coverage(lines, audio_words[audio], language=lang)
        print(f"  ♪ {title} ← {audio} (覆盖率 {cov:.0%})", file=sys.stderr)
        return (lyrics_mod.to_simplified(lrc), cov, lyrics_mod.to_simplified(lrc_words)) \
            if lyrics_mod.is_chinese_language(lang) else (lrc, cov, lrc_words)
    # 无匹配音频：无时间轴草稿
    header = f"[ti:{title}]\n[al:{album}]\n[ar:{artist}]\n[by:{by}]\n\n"
    if credits:
        header += "\n".join(credits) + "\n\n"
    track["audio"] = ""
    print(f"  ○ {title}: 无匹配音频，输出无时间轴草稿", file=sys.stderr)
    return header + "\n".join(lines) + "\n", 0.0, None


def build_authoritative_track(
    track: dict,
    audio_words: dict[str, list],
    used: set,
    audio_langs: dict[str, str] | None = None,
) -> tuple[str, float, Optional[str]]:
    """Retain uploaded LRC verbatim and optionally attach a bounded KLRC sidecar."""
    source_lrc = str(track.get("lrc") or "")
    lines = track.get("lines") or []
    audio = track.get("file") if track.get("file") in (audio_words or {}) else (
        match_audio_to_track(lines, audio_words, used, audio_langs) if audio_words else None)
    if not audio:
        track["audio"] = ""
        return source_lrc, 0.0, None
    used.add(audio)
    track["audio"] = audio
    klrc, coverage = authority_mod.build_authoritative_klrc(source_lrc, audio_words[audio])
    print(f"  ♪ {track.get('title', audio)} ← {audio}（权威 LRC，逐字覆盖率 {coverage:.0%}）", file=sys.stderr)
    return source_lrc, coverage, klrc


def align_tracks(
    tracks: list[dict],
    album: str,
    audio_words: dict[str, list],
    audio_langs: dict[str, str] | None = None,
    by: str = "",
    album_meta: dict | None = None,
) -> set:
    """逐轨对齐，把成品字段写进 track；返回被占用的音频名集合。

    成品字段：lrc / klrc / coverage / audio / aligned / edited。
    """
    used: set = set()
    for t in tracks:
        if t.get("authoritative_lrc"):
            lrc, cov, lrc_words = build_authoritative_track(t, audio_words, used, audio_langs)
        else:
            lrc, cov, lrc_words = build_track_lrc(
                t, album, audio_words, used, audio_langs, by=by, album_meta=album_meta)
        t["lrc"] = lrc
        t["klrc"] = lrc_words
        t["coverage"] = cov
        t["aligned"] = True
        t["edited"] = bool(t.get("edited"))
    return used


def track_needs_align(track: dict) -> bool:
    """人工改过、或草稿里没有可用的对齐成品 → 该轨需要（重新）对齐。"""
    if track.get("authoritative_lrc"):
        return False
    if track.get("timing_locked") and track.get("lrc"):
        return False
    return bool(track.get("edited")) or not track.get("aligned") or not track.get("lrc")


_TIMED_LYRIC_LINE_RE = re.compile(r"^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")


def _timed_lines(content: str) -> list[tuple[int, str]]:
    """提取可排序的计时歌词行，保留原行内容。"""
    entries: list[tuple[int, str]] = []
    for line in str(content or "").splitlines():
        match = _TIMED_LYRIC_LINE_RE.match(line)
        if not match:
            continue
        fraction = (match.group(3) or "").ljust(3, "0")
        entries.append(((int(match.group(1)) * 60 + int(match.group(2))) * 1000 + int(fraction), line))
    return entries


def _merge_timed_lyrics(main: str, additions: list[str]) -> str:
    """保留主声部非时间行，把附加声部时间行稳定并入同一时间轴。"""
    extra = [entry for content in additions for entry in _timed_lines(content)]
    if not extra:
        return main
    head = [line for line in str(main).splitlines() if not _TIMED_LYRIC_LINE_RE.match(line)]
    timeline = _timed_lines(main) + extra
    timeline.sort(key=lambda entry: entry[0])
    return "\n".join([*head, *(line for _, line in timeline)]) + "\n"


def merge_vocal_outputs(lrc: str, klrc: Optional[str], vocals: Any) -> tuple[str, Optional[str]]:
    """把已锁定且具备 LRC/KLRC 时间轴的附加声部写入最终成品。"""
    valid = [vocal for vocal in (vocals or []) if isinstance(vocal, dict)
             and vocal.get("timing_locked") and _timed_lines(vocal.get("lrc", ""))
             and _timed_lines(vocal.get("klrc", ""))]
    if not valid:
        return lrc, klrc
    return (
        _merge_timed_lyrics(lrc, [vocal["lrc"] for vocal in valid]),
        _merge_timed_lyrics(klrc, [vocal["klrc"] for vocal in valid]) if klrc else klrc,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────────────────────────────────────
def build_draft(
    *,
    tracks_explicit: list[dict] | None,
    booklet_text: str,
    credits_text: str,
    audio_words: dict[str, list] | None,
    audio_langs: dict[str, str] | None = None,
    tracks_plan: list[dict] | None = None,
    pages: list[dict] | None = None,
    image_paths: list[Path] | None = None,
    photo_links: dict[str, list[str] | str] | None = None,
    source_hint: str = "",
    manifest: dict,
    album_override: str = "",
    cover_path: Path | None = None,
    existing_meta: dict | None = None,
    default_lyric_maker: str = "",
    stt_cleanup: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """Phase A：整理素材并对齐为成品草稿（不写盘）。

    产出 draft：album + tracks（含分配歌词/归一化行/伴奏配对 + 对齐成品
    lrc/klrc/coverage/audio/aligned）+ 合并 meta + 名称字段 + 封面路径 + STT 词流
    + 原始 OCR 页。人工闸门直接校正成品；finalize 只对改动轨重算，其余直接落盘。
    """
    audio_words = audio_words or {}
    audio_langs = audio_langs or {}
    stt_cleanup = stt_cleanup or {}
    tracks_explicit = tracks_explicit or []

    # 1) 轨来源优先级：逐曲歌词 txt > 音频轨单（音频为中心）> 歌词本分轨（纯文本投稿）
    llm_meta: dict = {}
    if tracks_explicit:
        tracks = sorted(tracks_explicit, key=lambda t: t.get("order", 0) or 0)
        album_from_plan = ""
    elif tracks_plan and audio_words:
        # 音频为中心：轨=音频（曲名/曲序以音频文件为权威），歌词本 OCR 只做
        # 歌词修正与元信息一补——每曲分配到的原文找不到就留空（届时用该曲
        # 自身 STT 词流出草稿），不发明不凑数。
        # 逐页矫正约束：投稿者绑定页硬约束到指定轨；未绑定页先做页↔轨置信度
        # 匹配作分配提示，分配结果再经覆盖率验证（enforce_page_links）
        assignments: dict = {}
        confidence: dict = {}
        if image_paths:
            # 一步 vision（OCR 和出词合并）：直接看歌词本图片，按权威轨单分配歌词
            # + 抽 meta + 每轨置信度 + 每页转录（去掉会「拒绝难图」的独立 OCR 步骤）；
            # 人工绑定作强提示（非硬锁）
            link_hints = _vision_link_hints(photo_links, tracks_plan)
            vis = llm_assign_booklet_vision(image_paths, tracks_plan, link_hints)
            llm_meta = vis.get("meta", {}) or {}
            assignments = {str(k): v for k, v in (vis.get("assignments", {}) or {}).items()}
            confidence = {str(k): v for k, v in (vis.get("confidence", {}) or {}).items()}
            vis_pages = vis.get("pages")
            if isinstance(vis_pages, list) and vis_pages:
                pages = [{"name": str(p.get("name", "")), "kind": "VISION",
                          "text": str(p.get("text", ""))} for p in vis_pages]
        elif booklet_text or pages:
            link_orders: dict[str, int] = {}
            if pages:
                link_orders = link_orders_of(photo_links, tracks_plan)
                candidates = match_pages_to_tracks(pages, tracks_plan, audio_words, audio_langs)
                booklet_text = annotate_booklet(pages, tracks_plan, link_orders, candidates)
            assign = llm_assign_booklet(booklet_text, tracks_plan)
            llm_meta = assign.get("meta", {}) or {}
            assignments = assign.get("assignments", {}) or {}
            if pages:
                assignments = enforce_page_links(
                    assignments, pages, tracks_plan, link_orders, audio_words, audio_langs)
        tracks = [{
            "order": tp.get("order"),
            "title": str(tp.get("title", "")).strip(),
            "file": tp.get("file"),
            "lyrics": str(assignments.get(str(tp.get("order"))) or "").strip(),
            "inst": bool(tp.get("inst")),
            "confidence": confidence.get(str(tp.get("order"))),
        } for tp in tracks_plan]
        album_from_plan = ""
    elif booklet_text:
        plan = llm_split_booklet(booklet_text, manifest.get("album", ""))
        tracks = plan["tracks"]
        llm_meta = plan.get("meta", {}) or {}
        album_from_plan = plan.get("album", "")
    else:
        tracks = []
        llm_meta = {}
        album_from_plan = ""

    submission_type = str(manifest.get("submission_type") or "").strip().casefold()
    album = (album_override or manifest.get("album") or album_from_plan or "untitled").strip()
    if is_single_submission(submission_type):
        album = SINGLE_ALBUM_NAME

    # 无歌词文本时：STT 词流直接分行生成轨道（增补/新建均适用，覆盖旧 LRC）
    if not tracks and audio_words:
        tracks = _words_to_tracks(audio_words)
        print(f"  ⟳ 无歌词文本，由 STT 词流生成 {len(tracks)} 首轨道草稿", file=sys.stderr)

    # 轨道归一化：staff 行从歌词正文剥离（元信息不进时间轴），原样行保留
    # 用于双模式输出（头部标签 + 正文未计时 credit 行）
    for t in tracks:
        if t.get("authoritative_lrc"):
            # source LRC 的正文和时间轴不可由任何自动流程触及。
            continue
        raw_lines = t.get("lines") or [l for l in str(t.get("lyrics", "")).splitlines() if l.strip()]
        raw_lines = [l for l in raw_lines if not _SECTION_MARKER_RE.match(l)]  # 剥 [CREDITS]/[LYRICS] 段落标记
        t_staff, staff_rows, lyric_lines = lyrics_mod.split_staff_lines(raw_lines)
        merged = {k: list(v) for k, v in (t.get("staff") or {}).items()}
        for k, v in t_staff.items():
            cur = merged.setdefault(k, [])
            cur.extend(x for x in v if x not in cur)
        t["lines"], t["staff"], t["staff_rows"] = lyric_lines, merged, staff_rows
        t.pop("lyrics", None)

    # 伴奏/无人声轨复用同名正曲：歌词与时间轴完全 cv 正曲（借正曲的音频词流重新
    # align，输入相同→结果与正曲一致）；同名正曲不存在则 build_track_lrc 落到
    # 「纯音乐，请欣赏」占位
    _by_base_title: dict[str, dict] = {}
    for t in tracks:
        if t.get("inst"):
            continue
        base = _strip_inst_markers(str(t.get("title", "")).strip())
        if base and base not in _by_base_title:
            _by_base_title[base] = t
    for t in tracks:
        if not t.get("inst"):
            continue
        pair = _by_base_title.get(_strip_inst_markers(str(t.get("title", "")).strip()))
        if pair:
            t["lines"] = list(pair.get("lines") or [])
            t["_pair_file"] = pair.get("file")

    # 联网检索专辑官方元信息（staff/购买/发布页，歌词始终只来自投稿素材），
    # 填补歌词本没印全或 OCR 没读全的字段；音频 tag 的来源线索导向正确平台
    web_meta: dict = {}
    if tracks and web_mod.available():
        titles = [s for s in (str(t.get("title", "")).strip() for t in tracks) if s]
        info = web_mod.search_album_meta(
            album, str(manifest.get("artist") or ""), titles, source_hint=source_hint)
        if info.get("found"):
            raw: dict = dict(info.get("staff") or {})
            for k in ("购买", "发布"):
                if str(info.get(k) or "").strip():
                    raw[k] = str(info[k]).strip()
            web_meta = {_KEY_ALIAS.get(k, k): v for k, v in raw.items() if v}
            print(f"  🔍 专辑元信息检索命中（{info.get('source', '?')}）", file=sys.stderr)
        else:
            print("  🔍 未检索到专辑官方元信息", file=sys.stderr)
    # 封面第三优先级：显式文件/内嵌 tag 都没有时，从检索到的商品页下载
    if cover_path is None and str(web_meta.get("purchase") or "").strip():
        import tempfile
        cover_path = web_mod.download_cover(
            str(web_meta["purchase"]).strip(), Path(tempfile.mkdtemp()))

    # 2) meta：manifest > LLM(credits) > 逐曲 staff > 联网 staff > 现有 meta（增补时保底）
    credits_staff = lyrics_mod.parse_staff_block(credits_text.splitlines()) if credits_text else {}
    per_track_staff: dict[str, list] = {}
    for t in tracks:  # 逐曲 staff：显式歌词 txt 与分轨剥离出的都算
        for k, v in (t.get("staff") or {}).items():
            per_track_staff.setdefault(k, [])
            for name in v:
                if name not in per_track_staff[k]:
                    per_track_staff[k].append(name)
    meta = merge_meta(manifest, llm_meta, credits_staff, per_track_staff, web_meta, existing_meta or {})
    if default_lyric_maker and not meta.get("lyric_maker"):
        meta["lyric_maker"] = [default_lyric_maker]
    ensure_lyric_maker(meta)

    # 名称字段不在 FIELD_SCHEMA，merge_meta 不处理，手动按优先级计算：
    # manifest > existing_meta > album 字符串推断
    _man = manifest or {}
    _ex = existing_meta or {}
    names = {
        "prefix":  str(_man.get("prefix") or _ex.get("prefix") or ""),
        "zh_name": str(_man.get("zh_name") or _ex.get("zh_name") or "") or (album if _has_cjk(album) else ""),
        "en_name": str(_man.get("en_name") or _ex.get("en_name") or "") or ("" if _has_cjk(album) else album),
        "suffix":  str(_man.get("suffix") or _ex.get("suffix") or ""),
    }

    # 3) 对齐：草稿即成品，闸门所见即最终写盘内容
    align_tracks(tracks, album, audio_words, audio_langs,
                 by="/".join(meta.get("lyric_maker") or []), album_meta=meta)

    # 将人工绑定投影到页面数据，供审核面板显示一图多曲标记；旧草稿没有这些字段时
    # 仍可正常读取，关联本身只来自 manifest。
    page_rows = []
    page_links = link_orders_of(photo_links, tracks_plan or [])
    for page in pages or []:
        row = dict(page)
        orders = page_links.get(Path(str(row.get("name", ""))).name, [])
        row["linked_track_orders"] = orders
        row["linked_track_count"] = len(orders)
        row["is_shared"] = len(orders) > 1
        page_rows.append(row)

    return {
        "album": album, "submission_type": submission_type,
        "tracks": tracks, "meta": meta, "names": names,
        "audio_words": audio_words, "audio_langs": audio_langs,
        "stt_cleanup": stt_cleanup,
        "cover_path": str(cover_path) if cover_path else None,
        "pages": page_rows,
    }


def finalize(
    draft: dict[str, Any], res_dir: Path, dry_run: bool = False,
    single_target_exists: bool | None = None,
) -> dict[str, Any]:
    """Phase B：吃 build_draft 的成品草稿（或人工闸门校正后的草稿）→ 写 res/<专辑>/。

    只对人工改过（edited）或缺对齐成品的轨重跑对齐，其余直接落盘草稿里的 lrc/klrc。
    """
    single_submission = is_single_submission(draft.get("submission_type"))
    album = SINGLE_ALBUM_NAME if single_submission else _safe_album_name(draft.get("album"))
    tracks = draft["tracks"]
    meta = draft["meta"]
    names = draft["names"]
    audio_words = draft.get("audio_words") or {}
    audio_langs = draft.get("audio_langs") or {}
    cover_path = Path(draft["cover_path"]) if draft.get("cover_path") else None

    target_exists = (res_dir / album).is_dir() if single_target_exists is None else single_target_exists
    if single_submission and not target_exists:
        print(
            f"⚠️  单曲投稿未落盘：目标目录不存在 {res_dir / album}；请先创建既有单曲目录",
            file=sys.stderr,
        )
        return {
            "album": album, "written": [], "track_count": len(tracks), "matched": 0,
            "avg_coverage": 0.0, "result": "missing_single_directory",
        }

    # 3) 逐轨落盘：沿用草稿成品，仅改动轨重算
    written: list[str] = []
    album_rel = Path(album)

    def _emit(rel: Path, content: str | bytes):
        written.append(str(rel))
        if dry_run:
            print(f"[dry-run] 写入 {rel}", file=sys.stderr)
            return
        full = res_dir / rel
        full.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            full.write_bytes(content)
        else:
            full.write_text(content, encoding="utf-8")

    # 未重算的轨先回填音频占用，重算轨才不会抢走它们已匹配的音频
    redo = [track_needs_align(t) for t in tracks]
    used: set = {t["audio"] for t, r in zip(tracks, redo)
                 if not r and not t.get("inst") and t.get("audio")}

    covs: list[float] = []
    for i, (t, r) in enumerate(zip(tracks, redo), 1):
        order = t.get("order", i) or i
        if r:
            if t.get("authoritative_lrc"):
                lrc, cov, lrc_words = build_authoritative_track(t, audio_words, used, audio_langs)
            else:
                lrc, cov, lrc_words = build_track_lrc(
                    t, album, audio_words, used, audio_langs,
                    by="/".join(meta.get("lyric_maker") or []), album_meta=meta)
            t["lrc"], t["klrc"], t["coverage"], t["aligned"] = lrc, lrc_words, cov, True
        else:
            lrc, cov, lrc_words = t["lrc"], float(t.get("coverage") or 0.0), t.get("klrc")
        lrc, lrc_words = merge_vocal_outputs(lrc, lrc_words, t.get("vocals"))
        covs.append(cov)
        # build_track_lrc 匹配到音频后可能已用音频文件名回填空标题，故在其后取值
        basename = _output_basename(t, order, include_order=not single_submission)
        _emit(album_rel / f"{basename}.lrc", lrc)
        if lrc_words:
            # 逐字增强版另存 .klrc（非 .lrc 后缀），与标准 LRC 分离以保证播放器兼容性
            _emit(album_rel / f"{basename}.klrc", lrc_words)

    # 未匹配到轨的音频：单独输出机器转写（不丢）——此处仅记日志，避免误入库
    leftover = [n for n in audio_words if n not in used]
    if leftover:
        print(f"  ⚠️  {len(leftover)} 个音频未匹配任何轨: {leftover}", file=sys.stderr)

    if not single_submission:
        # 4) meta.toml — names 已由 build_draft 按优先级算好，直接渲染
        _emit(album_rel / "meta.toml", render_meta_toml(meta, names))

        # 5) cover
        if cover_path and cover_path.is_file():
            ext = cover_path.suffix.lower() or ".png"
            _emit(album_rel / f"cover{ext}", cover_path.read_bytes())

    return {
        "album": album, "written": written, "track_count": len(tracks),
        "matched": len(used), "avg_coverage": round(sum(covs) / len(covs), 3) if covs else 0.0,
        "result": "ok",
    }


def organize(
    *,
    tracks_explicit: list[dict] | None,
    booklet_text: str,
    credits_text: str,
    audio_words: dict[str, list] | None,
    audio_langs: dict[str, str] | None = None,
    tracks_plan: list[dict] | None = None,
    pages: list[dict] | None = None,
    photo_links: dict[str, list[str] | str] | None = None,
    source_hint: str = "",
    manifest: dict,
    res_dir: Path,
    album_override: str = "",
    cover_path: Path | None = None,
    existing_meta: dict | None = None,
    dry_run: bool = False,
    default_lyric_maker: str = "",
) -> dict[str, Any]:
    """一次性跑完 = build_draft + finalize（向后兼容 CLI 与现有测试；无人工闸门）。"""
    draft = build_draft(
        tracks_explicit=tracks_explicit, booklet_text=booklet_text, credits_text=credits_text,
        audio_words=audio_words, audio_langs=audio_langs, tracks_plan=tracks_plan,
        pages=pages, photo_links=photo_links, source_hint=source_hint, manifest=manifest,
        album_override=album_override, cover_path=cover_path, existing_meta=existing_meta,
        default_lyric_maker=default_lyric_maker,
    )
    return finalize(draft, res_dir=res_dir, dry_run=dry_run)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="整理摄取素材为 res/<专辑>/（含对齐）")
    ap.add_argument("--lyrics-dir", help="逐曲歌词 txt 目录")
    ap.add_argument("--booklet-text", help="歌词本合并文本（无逐曲歌词时 LLM 分轨）")
    ap.add_argument("--credits", help="专辑级 credits 文本文件（抽 meta）")
    ap.add_argument("--words-json", help="audio_words JSON：{音频名:[{start,end,text}]}")
    ap.add_argument("--manifest")
    ap.add_argument("--cover")
    ap.add_argument("--res-dir", default="res")
    ap.add_argument("--album", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    tracks_explicit: list[dict] = []
    if args.lyrics_dir:
        for p in sorted(Path(args.lyrics_dir).glob("*.txt")):
            txt = p.read_text(encoding="utf-8", errors="replace")
            if lyrics_mod.is_credits_only(txt):
                continue
            parsed = lyrics_mod.parse_lyric_txt(p)
            parsed["order"] = _order_from_name(p.stem)
            tracks_explicit.append(parsed)

    booklet_text = Path(args.booklet_text).read_text(encoding="utf-8", errors="replace") if args.booklet_text and Path(args.booklet_text).is_file() else ""
    credits_text = Path(args.credits).read_text(encoding="utf-8", errors="replace") if args.credits and Path(args.credits).is_file() else ""
    audio_words = json.loads(Path(args.words_json).read_text(encoding="utf-8")) if args.words_json and Path(args.words_json).is_file() else {}
    manifest = _read_toml(Path(args.manifest)) if args.manifest else {}

    result = organize(
        tracks_explicit=tracks_explicit, booklet_text=booklet_text, credits_text=credits_text,
        audio_words=audio_words, manifest=manifest, res_dir=Path(args.res_dir),
        album_override=args.album, cover_path=Path(args.cover) if args.cover else None, dry_run=args.dry_run,
    )
    print(f"✓ 专辑「{result['album']}」：{result['track_count']} 轨，"
          f"{result['matched']} 轨对齐音频，平均覆盖率 {result['avg_coverage']:.0%}，"
          f"{len(result['written'])} 文件", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def _order_from_name(stem: str) -> int:
    import re
    m = re.match(r"\s*(\d+)", stem)
    return int(m.group(1)) if m else 0


if __name__ == "__main__":
    raise SystemExit(main())
