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
- <序号> <曲名>.lrc：音频按覆盖率匹配到轨 → align 强制对齐成 timed LRC；无匹配音频则写无时间轴草稿
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
    from ingest import _llm, align as align_mod, lyrics as lyrics_mod  # type: ignore
else:
    from . import _llm, align as align_mod, lyrics as lyrics_mod

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
作词/作曲/编曲/演唱/调校/混音/曲绘等制作信息和发行/购买/出品等源信息）。整理成结构化 JSON。

输出 JSON（只输出 JSON）：
{
  "album": "专辑名（能确定则填，否则空）",
  "meta": {"year":"","produce":[],"release":"","purchase":"","electronic":"","lyric_maker":[],
           "vocal":[],"lyricist":[],"composer":[],"arranger":[],"tuning":[],"illustrator":[],"mixer":[]},
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


# ──────────────────────────────────────────────────────────────────────────────
# 增补：从现有 res/<专辑>/ 加载 LRC（剥离时间戳），供音频重新对齐
# ──────────────────────────────────────────────────────────────────────────────
_LRC_HEADER_RE = re.compile(r"^\[(ti|al|ar|by|offset):", re.I)
_LRC_TIMESTAMP_RE = re.compile(r"^\[\d{1,2}:\d{2}\.\d{2,3}\]")


def _load_existing_tracks(album_dir: Path) -> list[dict]:
    """从已有专辑目录读取 LRC 文件，剥离时间戳后返回纯歌词轨列表。
    用于增补模式：上传音频但未提供歌词时，借现有 LRC 重新对齐获得时间轴。
    """
    tracks: list[dict] = []
    for lrc_path in sorted(album_dir.glob("*.lrc")):
        m = re.match(r"^(\d+)\s+(.+)$", lrc_path.stem)
        order = int(m.group(1)) if m else 0
        title = m.group(2) if m else lrc_path.stem
        lines: list[str] = []
        for raw in lrc_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if _LRC_HEADER_RE.match(raw):
                continue
            text = _LRC_TIMESTAMP_RE.sub("", raw).strip()
            if text:
                lines.append(text)
        if lines:
            tracks.append({"order": order, "title": title, "lines": lines, "staff": {}})
    return tracks


# ──────────────────────────────────────────────────────────────────────────────
# LLM 分轨（仅当没有逐曲歌词时）
# ──────────────────────────────────────────────────────────────────────────────
def llm_split_booklet(source_text: str, album_hint: str) -> dict:
    user = source_text.strip()
    if album_hint:
        user = f"【目标专辑】{album_hint}\n\n{user}"
    plan = None
    if user:
        resp = _llm.chat_safe(
            [{"role": "system", "content": ORGANIZE_SYSTEM}, {"role": "user", "content": user[:12000]}],
            model=_llm.text_model(),
        )
        if resp:
            plan = _llm.extract_json(resp)
    if not isinstance(plan, dict):
        plan = {"album": album_hint, "meta": {},
                "tracks": [{"order": 1, "title": album_hint or "untitled", "lyrics": source_text.strip()}]}
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
def match_audio_to_track(track_lines: list[str], audio_words: dict[str, list], used: set) -> Optional[str]:
    """在未使用的音频里选与该轨歌词覆盖率最高者；低于阈值返回 None。"""
    best, best_cov = None, MATCH_THRESHOLD
    for name, words in audio_words.items():
        if name in used:
            continue
        cov = align_mod.coverage(track_lines, words)
        if cov >= best_cov:
            best, best_cov = name, cov
    return best


def build_track_lrc(track: dict, album: str, audio_words: dict[str, list], used: set) -> tuple[str, float]:
    """为一轨生成 LRC：能匹配音频→对齐(timed)，否则无时间轴草稿。返回(lrc, 覆盖率)。"""
    title = str(track.get("title", "")).strip()
    lines = track.get("lines") or [l for l in str(track.get("lyrics", "")).splitlines() if l.strip()]
    by = ""
    staff = track.get("staff") or {}
    if staff.get("lyricist"):
        by = "/".join(staff["lyricist"])
    audio = match_audio_to_track(lines, audio_words, used) if audio_words else None
    if audio:
        used.add(audio)
        lrc = align_mod.align(lines, audio_words[audio], title=title, album=album, by=by)
        cov = align_mod.coverage(lines, audio_words[audio])
        print(f"  ♪ {title} ← {audio} (覆盖率 {cov:.0%})", file=sys.stderr)
        return lrc, cov
    # 无匹配音频：无时间轴草稿
    header = f"[ti:{title}]\n[al:{album}]\n[ar:]\n[by:{by}]\n\n"
    print(f"  ○ {title}: 无匹配音频，输出无时间轴草稿", file=sys.stderr)
    return header + "\n".join(lines) + "\n", 0.0


# ──────────────────────────────────────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────────────────────────────────────
def organize(
    *,
    tracks_explicit: list[dict] | None,
    booklet_text: str,
    credits_text: str,
    audio_words: dict[str, list] | None,
    manifest: dict,
    res_dir: Path,
    album_override: str = "",
    cover_path: Path | None = None,
    existing_meta: dict | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    audio_words = audio_words or {}
    tracks_explicit = tracks_explicit or []
    is_incremental = existing_meta is not None

    # 1) 轨来源：优先逐曲歌词；否则 LLM 分轨（增补且无文本时跳过 LLM，避免生成空轨）
    llm_meta: dict = {}
    if tracks_explicit:
        tracks = sorted(tracks_explicit, key=lambda t: t.get("order", 0) or 0)
        album_from_plan = ""
    elif booklet_text or not is_incremental:
        plan = llm_split_booklet(booklet_text, manifest.get("album", ""))
        tracks = plan.get("tracks") or []
        llm_meta = plan.get("meta", {}) or {}
        album_from_plan = plan.get("album", "")
    else:
        # 增补模式且无新文本：不调 LLM，稍后视情况加载现有 LRC
        tracks = []
        llm_meta = {}
        album_from_plan = ""

    album = (album_override or manifest.get("album") or album_from_plan or "untitled").strip()

    # 增补 + 仅提供音频：从现有 LRC 加载歌词，供重新对齐以获取时间轴
    if not tracks and audio_words and is_incremental:
        existing_dir = res_dir / album
        if existing_dir.is_dir():
            loaded = _load_existing_tracks(existing_dir)
            if loaded:
                tracks = sorted(loaded, key=lambda t: t.get("order", 0) or 0)
                print(f"  ↻ 增补：加载现有 {len(tracks)} 首 LRC 以对齐新音频", file=sys.stderr)

    # 2) meta：manifest > LLM(credits) > 逐曲 staff > 现有 meta（增补时保底）
    credits_staff = lyrics_mod.parse_staff_block(credits_text.splitlines()) if credits_text else {}
    per_track_staff: dict[str, list] = {}
    for t in tracks_explicit:
        for k, v in (t.get("staff") or {}).items():
            per_track_staff.setdefault(k, [])
            for name in v:
                if name not in per_track_staff[k]:
                    per_track_staff[k].append(name)
    meta = merge_meta(manifest, llm_meta, credits_staff, per_track_staff, existing_meta or {})

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
        title = _sanitize_filename(str(t.get("title", "")).strip() or f"track{order}")
        lrc, cov = build_track_lrc(t, album, audio_words, used)
        covs.append(cov)
        _emit(album_rel / f"{order} {title}.lrc", lrc)

    # 未匹配到轨的音频：单独输出机器转写（不丢）——此处仅记日志，避免误入库
    leftover = [n for n in audio_words if n not in used]
    if leftover:
        print(f"  ⚠️  {len(leftover)} 个音频未匹配任何轨: {leftover}", file=sys.stderr)

    # 4) meta.toml — 增补时保留已有专辑名字段
    _ex = existing_meta or {}
    names = {
        "prefix":  _ex.get("prefix",  ""),
        "zh_name": _ex.get("zh_name", "") or (album if _has_cjk(album) else ""),
        "en_name": _ex.get("en_name", "") or ("" if _has_cjk(album) else album),
        "suffix":  _ex.get("suffix",  ""),
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
