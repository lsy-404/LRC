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
    from ingest import _llm, align as align_mod, lyrics as lyrics_mod, websearch as web_mod  # type: ignore
else:
    from . import _llm, align as align_mod, lyrics as lyrics_mod, websearch as web_mod

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
1. 剔除伴奏/instrumental 版本（文件名含 INST/instrumental/off vocal/伴奏 等）
2. 按文件名中的曲序号排序，并重新编号为连续的 1..N
3. title 取歌曲本身名称：去掉序号前缀与结尾句号/多余空白，保留歌名内的标点
4. file 必须是原文件名的逐字符原样
只输出 JSON：{"tracks":[{"order":1,"title":"...","file":"..."}]}"""


def llm_order_tracks(audio_names: list[str], album_hint: str = "") -> list[dict]:
    """音频文件名 → 权威轨单（歌曲本身名称优先）。失败抛 LLMError。"""
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
    return valid


ASSIGN_SYSTEM = """你是音乐专辑歌词整理专家。给你专辑的权威轨单（来自音频文件，顺序与曲名
以此为准，不得增删改）和歌词本 OCR 混合文本（可能含歌词及作词/作曲/编曲/演唱/调校/混音/
母带/曲绘/视频/策划等制作信息和发行/购买/出品等源信息）。

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


def build_track_lrc(
    track: dict,
    album: str,
    audio_words: dict[str, list],
    used: set,
    audio_langs: dict[str, str] | None = None,
    by: str = "",
) -> tuple[str, float, Optional[str]]:
    """为一轨生成 LRC：能匹配音频→对齐(timed)，否则无时间轴草稿。

    返回 (lrc, 覆盖率, lrc_words)。lrc 是标准行级 LRC（不含逐字标签，
    保证任何播放器/解析器兼容）；lrc_words 是同一份对齐结果的逐字增强版
    （行内 <字时间> 标签），另存 .klrc 侧车文件，不匹配音频时为 None。
    """
    title = str(track.get("title", "")).strip()
    lines = track.get("lines") or [l for l in str(track.get("lyrics", "")).splitlines() if l.strip()]
    staff = track.get("staff") or {}
    credits = track.get("staff_rows") or []
    artist = "/".join(staff.get("vocal", []))
    # 轨单路径：轨即音频，直连不做模糊匹配；否则按歌词相似度匹配
    audio = track.get("file") if track.get("file") in (audio_words or {}) else (
        match_audio_to_track(lines, audio_words, used, audio_langs) if audio_words else None)
    if audio:
        used.add(audio)
        if not lines:
            # 歌词本没有该曲文本：用它自身 STT 词流出草稿行（曲名仍来自轨单）
            lines = _words_to_lines(audio_words[audio])
            print(f"  ⟳ {title or audio}: 歌词本无此曲文本，STT 草稿", file=sys.stderr)
        if not title:
            # 音频文件名自带曲名（投稿者命名/内嵌tag），比 OCR 读出的标题可靠
            stem = Path(audio).stem
            m = re.match(r"^\d+[\s._-]+(.*)", stem)
            title = (m.group(1) if m else stem).strip().strip("。.")
            track["title"] = title
        lang = (audio_langs or {}).get(audio, "")
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
        return lrc, cov, lrc_words
    # 无匹配音频：无时间轴草稿
    header = f"[ti:{title}]\n[al:{album}]\n[ar:{artist}]\n[by:{by}]\n\n"
    if credits:
        header += "\n".join(credits) + "\n\n"
    print(f"  ○ {title}: 无匹配音频，输出无时间轴草稿", file=sys.stderr)
    return header + "\n".join(lines) + "\n", 0.0, None


# ──────────────────────────────────────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────────────────────────────────────
def organize(
    *,
    tracks_explicit: list[dict] | None,
    booklet_text: str,
    credits_text: str,
    audio_words: dict[str, list] | None,
    audio_langs: dict[str, str] | None = None,
    tracks_plan: list[dict] | None = None,
    manifest: dict,
    res_dir: Path,
    album_override: str = "",
    cover_path: Path | None = None,
    existing_meta: dict | None = None,
    dry_run: bool = False,
    default_lyric_maker: str = "",
) -> dict[str, Any]:
    audio_words = audio_words or {}
    audio_langs = audio_langs or {}
    tracks_explicit = tracks_explicit or []

    # 1) 轨来源优先级：逐曲歌词 txt > 音频轨单（音频为中心）> 歌词本分轨（纯文本投稿）
    llm_meta: dict = {}
    if tracks_explicit:
        tracks = sorted(tracks_explicit, key=lambda t: t.get("order", 0) or 0)
        album_from_plan = ""
    elif tracks_plan and audio_words:
        # 音频为中心：轨=音频（曲名/曲序以音频文件为权威），歌词本 OCR 只做
        # 歌词修正与元信息一补——每曲分配到的原文找不到就留空（届时用该曲
        # 自身 STT 词流出草稿），不发明不凑数
        assignments: dict = {}
        if booklet_text:
            assign = llm_assign_booklet(booklet_text, tracks_plan)
            llm_meta = assign.get("meta", {}) or {}
            assignments = assign.get("assignments", {}) or {}
        tracks = [{
            "order": tp.get("order"),
            "title": str(tp.get("title", "")).strip(),
            "file": tp.get("file"),
            "lyrics": str(assignments.get(str(tp.get("order"))) or "").strip(),
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

    album = (album_override or manifest.get("album") or album_from_plan or "untitled").strip()

    # 无歌词文本时：STT 词流直接分行生成轨道（增补/新建均适用，覆盖旧 LRC）
    if not tracks and audio_words:
        tracks = _words_to_tracks(audio_words)
        print(f"  ⟳ 无歌词文本，由 STT 词流生成 {len(tracks)} 首轨道草稿", file=sys.stderr)

    # 轨道归一化：staff 行从歌词正文剥离（元信息不进时间轴），原样行保留
    # 用于双模式输出（头部标签 + 正文未计时 credit 行）
    for t in tracks:
        raw_lines = t.get("lines") or [l for l in str(t.get("lyrics", "")).splitlines() if l.strip()]
        t_staff, staff_rows, lyric_lines = lyrics_mod.split_staff_lines(raw_lines)
        merged = {k: list(v) for k, v in (t.get("staff") or {}).items()}
        for k, v in t_staff.items():
            cur = merged.setdefault(k, [])
            cur.extend(x for x in v if x not in cur)
        t["lines"], t["staff"], t["staff_rows"] = lyric_lines, merged, staff_rows
        t.pop("lyrics", None)

    # 联网检索专辑官方元信息（仅 staff/制作者，歌词始终只来自投稿素材），
    # 填补歌词本没印全或 OCR 没读全的 credits 字段
    web_staff: dict[str, list] = {}
    if tracks and web_mod.available():
        titles = [s for s in (str(t.get("title", "")).strip() for t in tracks) if s]
        info = web_mod.search_album_meta(album, str(manifest.get("artist") or ""), titles)
        if info.get("found"):
            web_staff = {k: list(v) for k, v in (info.get("staff") or {}).items() if v}
            print(f"  🔍 专辑元信息检索命中（{info.get('source', '?')}）", file=sys.stderr)
        else:
            print("  🔍 未检索到专辑官方元信息", file=sys.stderr)

    # 2) meta：manifest > LLM(credits) > 逐曲 staff > 联网 staff > 现有 meta（增补时保底）
    credits_staff = lyrics_mod.parse_staff_block(credits_text.splitlines()) if credits_text else {}
    per_track_staff: dict[str, list] = {}
    for t in tracks:  # 逐曲 staff：显式歌词 txt 与分轨剥离出的都算
        for k, v in (t.get("staff") or {}).items():
            per_track_staff.setdefault(k, [])
            for name in v:
                if name not in per_track_staff[k]:
                    per_track_staff[k].append(name)
    web_meta = lyrics_mod.parse_staff_block(
        [f"{k}：{'、'.join(v)}" for k, v in web_staff.items() if v]) if web_staff else {}
    meta = merge_meta(manifest, llm_meta, credits_staff, per_track_staff, web_meta, existing_meta or {})
    if default_lyric_maker and not meta.get("lyric_maker"):
        meta["lyric_maker"] = [default_lyric_maker]

    # 3) 逐轨生成 LRC（匹配音频 + 对齐）
    used: set = set()
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

    covs: list[float] = []
    for i, t in enumerate(tracks, 1):
        order = t.get("order", i) or i
        lrc, cov, lrc_words = build_track_lrc(
            t, album, audio_words, used, audio_langs,
            by="/".join(meta.get("lyric_maker") or []))
        covs.append(cov)
        # build_track_lrc 匹配到音频后可能已用音频文件名回填空标题，故在其后取值
        title = _sanitize_filename(str(t.get("title", "")).strip() or f"track{order}")
        _emit(album_rel / f"{order} {title}.lrc", lrc)
        if lrc_words:
            # 逐字增强版另存 .klrc（非 .lrc 后缀），与标准 LRC 分离以保证播放器兼容性
            _emit(album_rel / f"{order} {title}.klrc", lrc_words)

    # 未匹配到轨的音频：单独输出机器转写（不丢）——此处仅记日志，避免误入库
    leftover = [n for n in audio_words if n not in used]
    if leftover:
        print(f"  ⚠️  {len(leftover)} 个音频未匹配任何轨: {leftover}", file=sys.stderr)

    # 4) meta.toml — 名称字段不在 FIELD_SCHEMA，merge_meta 不处理，手动按优先级计算
    #    manifest > existing_meta > album 字符串推断
    _man = manifest or {}
    _ex = existing_meta or {}
    names = {
        "prefix":  str(_man.get("prefix") or _ex.get("prefix") or ""),
        "zh_name": str(_man.get("zh_name") or _ex.get("zh_name") or "") or (album if _has_cjk(album) else ""),
        "en_name": str(_man.get("en_name") or _ex.get("en_name") or "") or ("" if _has_cjk(album) else album),
        "suffix":  str(_man.get("suffix") or _ex.get("suffix") or ""),
    }
    _emit(album_rel / "meta.toml", render_meta_toml(meta, names))

    # 5) cover
    if cover_path and cover_path.is_file():
        ext = cover_path.suffix.lower() or ".png"
        _emit(album_rel / f"cover{ext}", cover_path.read_bytes())

    return {
        "album": album, "written": written, "track_count": len(tracks),
        "matched": len(used), "avg_coverage": round(sum(covs) / len(covs), 3) if covs else 0.0,
    }


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
