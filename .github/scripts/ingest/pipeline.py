#!/usr/bin/env python3
"""ingest/pipeline.py — 摄取管道单入口（workflow 调用它）。

扫描投递目录，按类型分流，整理成 res/<专辑>/（STT 时间轴 × 歌词本文本强制对齐）：

    逐曲歌词 txt          → 解析(标题/分曲 staff/正文) → 直接成轨
    专辑级 credits txt     → 抽 meta（不成轨）
    图片(.png/.jpg/...)    → OCR ┐
    文档(.pdf/.docx)       → 抽取 ┼→ 歌词本文本(无逐曲歌词时 LLM 分轨；并供抽 credits)
    草稿 .txt（含歌词）    → 也按逐曲歌词处理
    音频(.wav/.flac/...)   → faster-whisper 词级时间戳 → audio_words
    封面图（主视图/cover/最大图）→ cover.*
    manifest.toml          → 专辑名 + meta 覆盖 + [链接] 歌词拍照→音轨绑定
                             + 伴奏/原曲 显式标记（覆盖文件名 inst 启发式）
                                          ↓
                              ingest.organize → res/<专辑>/

用法：
    python -m ingest.pipeline --src <投递目录> --res-dir res [--album NAME] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from ingest import ocr as ocr_mod  # type: ignore
    from ingest import documents as doc_mod
    from ingest import stt as stt_mod
    from ingest import organize as org_mod
    from ingest import lyrics as lyrics_mod
    from ingest import review as review_mod
    from ingest import authority_lrc as authority_mod
else:
    from . import ocr as ocr_mod
    from . import documents as doc_mod
    from . import stt as stt_mod
    from . import organize as org_mod
    from . import lyrics as lyrics_mod
    from . import review as review_mod
    from . import authority_lrc as authority_mod

TEXT_EXTS = {".txt"}
LRC_EXTS = {".lrc"}
IGNORE_NAMES = {"manifest.toml", "readme.md", "readme.txt", ".gitkeep", ".ds_store"}
IGNORE_DIRS = {".git", ".github"}
COVER_HINT = re.compile(r"cover|封面|主视图|jacket", re.I)


def _iter_files(src: Path):
    for p in sorted(src.rglob("*")):
        if not p.is_file():
            continue
        if any(part in IGNORE_DIRS for part in p.parts):
            continue
        if p.name.lower() in IGNORE_NAMES:
            continue
        yield p


def classify(src: Path) -> dict[str, list[Path]]:
    buckets: dict[str, list[Path]] = {"image": [], "doc": [], "audio": [], "text": [], "lrc": [], "other": []}
    for p in _iter_files(src):
        ext = p.suffix.lower()
        if ext in ocr_mod.IMAGE_EXTS:
            buckets["image"].append(p)
        elif ext in doc_mod.DOC_EXTS:
            buckets["doc"].append(p)
        elif ext in stt_mod.AUDIO_EXTS:
            buckets["audio"].append(p)
        elif ext in TEXT_EXTS:
            buckets["text"].append(p)
        elif ext in LRC_EXTS:
            buckets["lrc"].append(p)
        else:
            buckets["other"].append(p)
    return buckets


def pick_cover(images: list[Path]) -> Path | None:
    """只认显式命名的封面文件（cover/封面/主视图/jacket）。

    封面优先级：显式文件 > 音频内嵌 tag > 无——没有就是没有，
    不拿歌词本照片凑数。
    """
    named = [p for p in images if COVER_HINT.search(p.name)]
    return max(named, key=lambda p: p.stat().st_size) if named else None


def extract_audio_meta(audios: list[Path]) -> tuple[dict, str]:
    """音频内嵌 tag → 权威元信息 + 来源线索。

    投稿者音频文件的内嵌 tag（date/comments）比联网猜测可靠：date 直接作
    发行日期；comments（常含 dizzylab/@厂牌 等来源）作为联网检索的线索。
    返回 (internal 键 meta, 来源线索字符串)。
    """
    if not audios:
        return {}, ""
    from mutagen import File as MutagenFile
    meta: dict = {}
    hint = ""
    for a in audios:
        tags = getattr(MutagenFile(str(a)), "tags", None) or {}

        def _get(key: str) -> str:
            v = tags.get(key)
            return str(v[0]).strip() if v else ""

        if not meta.get("year") and _get("date"):
            meta["year"] = _get("date")
        if not hint and _get("comments"):
            hint = " ".join(_get("comments").split())
        if meta.get("year") and hint:
            break
    if meta.get("year"):
        print(f"  ◈ 发行日期取自音频 tag: {meta['year']}", file=sys.stderr)
    if hint:
        print(f"  ◈ 来源线索取自音频 tag: {hint}", file=sys.stderr)
    return meta, hint


def extract_embedded_cover(audios: list[Path], work: Path) -> Path | None:
    """从音频内嵌 tag 提取封面（FLAC pictures；专辑内通常一致，取第一个带图的）。"""
    if not audios:
        return None
    from mutagen import File as MutagenFile
    for a in audios:
        pics = getattr(MutagenFile(str(a)), "pictures", None) or []
        if pics:
            data = pics[0].data
            ext = ".png" if data[:4] == b"\x89PNG" else ".jpg"
            out = work / f"embedded_cover{ext}"
            out.write_bytes(data)
            print(f"  ◉ 封面取自音频内嵌 tag: {a.name}", file=sys.stderr)
            return out
    return None


def extract_photo_links(manifest: dict) -> dict[str, str]:
    """从 manifest 弹出 [链接]/links 表（歌词拍照→音轨绑定）→ {图片名: 音频名}。

    basename 归一（上传页改路径只动目录段）；弹出以防误入 meta 合并链。
    """
    out: dict[str, str] = {}
    for key in ("links", "链接"):
        v = manifest.pop(key, None)
        if isinstance(v, dict):
            for img, audio in v.items():
                out[Path(str(img)).name] = Path(str(audio)).name
    return out


def extract_inst_overrides(manifest: dict) -> tuple[set, set]:
    """弹出 manifest 的 伴奏/原曲 显式标记（工作站 inst 弹窗的选择）→ basename 集合。

    伴奏：强制按伴奏/无人声轨处理（不转写，复用同名正曲时间轴或写纯音乐占位）；
    原曲：推翻文件名启发式的误伤，按正曲转写对齐。pop 掉避免混进 meta 合并链。
    """
    out: list[set] = []
    for key in ("伴奏", "原曲"):
        v = manifest.pop(key, None)
        names = ({Path(str(x)).name for x in v if str(x).strip()}
                 if isinstance(v, list) else set())
        out.append(names)
    return out[0], out[1]


def extract_album_pages(manifest: dict) -> set:
    """manifest album_pages（SP 分配的专辑级元信息照片名）→ basename 集合。

    这些页作 credits 抽 meta，不进歌词分配/页↔轨匹配（封面/制作/发行 credits 页）。
    """
    v = manifest.get("album_pages")
    if not isinstance(v, list):
        return set()
    return {Path(str(x)).name for x in v}


def find_album_dirs(src: Path) -> list[Path]:
    """上传根目录下、用作专辑名的顶层文件夹（专辑 = 文件夹名）。"""
    out = []
    for p in sorted(src.iterdir()):
        if not p.is_dir():
            continue
        if p.name in IGNORE_DIRS or p.name.startswith("."):
            continue
        out.append(p)
    return out


def _album_slug(album: str) -> str:
    """专辑名 → bundle 子目录名（清掉路径非法字符；空则 untitled）。"""
    bad = '<>:"/\\|?*'
    slug = "".join("_" if c in bad else c for c in (album or "")).strip()
    return slug or "untitled"


def _resolve_jobs(src: Path, album: str) -> list[tuple[str, Path]]:
    """专辑识别：显式 --album 整体一张；否则顶层文件夹各一张；再否则素材在根、名待定。"""
    if album:
        return [(album, src)]
    album_dirs = find_album_dirs(src)
    if album_dirs:
        return [(d.name, d) for d in album_dirs]
    return [("", src)]


def run(src: Path, res_dir: Path, work: Path, album: str, dry_run: bool, lyric_maker: str = "") -> dict:
    """识别专辑（= 上传里的顶层文件夹名）并逐个处理。

    - 上传根下每个文件夹视为一张专辑，文件夹名即专辑名（无需 manifest）。
    - 若用 --album 显式指定，或根下无文件夹（素材直接在根），则整体当一张专辑。
    """
    work.mkdir(parents=True, exist_ok=True)
    jobs = _resolve_jobs(src, album)
    print(f"识别到 {len(jobs)} 张专辑：{[a for a, _ in jobs]}", file=sys.stderr)

    albums_out = []
    for album_name, album_src in jobs:
        albums_out.append(_process_album(album_name, album_src, res_dir, work, dry_run, lyric_maker))
    ok = any(a.get("result") == "ok" for a in albums_out)
    done = [a.get("album", "") for a in albums_out if a.get("result") == "ok"]
    is_update = any(a.get("is_update") for a in albums_out if a.get("result") == "ok")
    return {"albums": albums_out, "result": "ok" if ok else "empty",
            "album": "、".join(n for n in done if n),  # 供 workflow 做 PR 标题
            "is_update": is_update,
            "written": [w for a in albums_out for w in a.get("written", [])]}


def _process_album(album: str, src: Path, res_dir: Path, work: Path, dry_run: bool,
                   lyric_maker: str = "", *, mode: str = "oneshot",
                   bundle_root: Path | None = None, timestamp: str = "",
                   contributor: str = "") -> dict:
    """mode='oneshot'：素材 → build_draft（含对齐）→ finalize → res/（无闸门）。
    mode='phase_a'：素材 → build_draft → review.write_bundle 到 bundle_root/<album>/（停在待修改）。
    """
    buckets = classify(src)
    summary: dict = {k: [p.name for p in v] for k, v in buckets.items()}
    print(f"分流：图片{len(buckets['image'])} 文档{len(buckets['doc'])} 音频{len(buckets['audio'])} "
          f"文字{len(buckets['text'])} LRC{len(buckets['lrc'])} 其他{len(buckets['other'])}", file=sys.stderr)

    # 1) 逐曲歌词 txt / credits txt
    tracks_explicit: list[dict] = []
    credits_parts: list[str] = []
    for p in buckets["text"]:
        txt = p.read_text(encoding="utf-8", errors="replace")
        if lyrics_mod.is_credits_only(txt):
            credits_parts.append(txt)
            print(f"  credits: {p.name}", file=sys.stderr)
            continue
        parsed = lyrics_mod.parse_lyric_txt(p)
        parsed["order"] = _order_from_name(p.stem)
        if parsed["lines"]:
            tracks_explicit.append(parsed)
            print(f"  歌词轨: {p.name} → {parsed['title']} ({len(parsed['lines'])} 行)", file=sys.stderr)

    # 上传 LRC 是绝对权威来源。它从此处起携带原始文本到草稿和最终输出；后续
    # STT 只可生成独立 .klrc 侧车，不能改写、清理、排序或格式化该 LRC。
    for order, p in enumerate(buckets["lrc"], len(tracks_explicit) + 1):
        tracks_explicit.append(authority_mod.load_authoritative_track(p, order))
        print(f"  权威 LRC: {p.name}", file=sys.stderr)

    # manifest 提前读：伴奏/原曲 显式标记须在轨单编排（第 3 步）生效，SP 页分流
    # （第 2 步）也用它；meta 覆盖仍在第 5 步与音频 tag 合并
    manifest_path = src / "manifest.toml"
    manifest = org_mod._read_toml(manifest_path) if manifest_path.is_file() else {}
    photo_links = extract_photo_links(manifest)
    if photo_links:
        print(f"  🔗 manifest 携带 {len(photo_links)} 条歌词拍照绑定", file=sys.stderr)
    inst_marked, inst_as_song = extract_inst_overrides(manifest)

    # 2) 图片 OCR + 文档抽取 → 逐页歌词本文本（保留页出处，供绑定/置信度匹配；
    #    拼接版供纯文本分轨与抽 credits）
    pages: list[dict] = []
    cover = pick_cover(buckets["image"]) or extract_embedded_cover(buckets["audio"], work)
    ocr_images = [p for p in buckets["image"] if p != cover]  # 封面不做歌词处理
    # 图片走一步 vision：build_draft 用 luna 直接看图分轨（OCR 和出词合并），不跑会
    # 「拒绝难图」的独立 OCR。pdf/docx vision 读不了 → 抽文本进 credits 供抽 meta；
    # 无图（纯文本/文档投稿）时才把文档文本作为分轨用 pages 走旧文本路径。
    image_paths = ocr_images or None
    if buckets["doc"]:
        for name, t in doc_mod.run(buckets["doc"]).items():
            if image_paths:
                if t.strip():
                    credits_parts.append(t)
            else:
                pages.append({"name": name, "kind": "DOC", "text": t})

    # SP 专辑级元信息页（manifest album_pages）：仅无图的文本页需分流到 credits；
    # 有图时 vision 直接看到 SP 页并抽 meta，无需分流
    if pages:
        album_pages = extract_album_pages(manifest)
        if album_pages:
            sp_pages = [pg for pg in pages if pg["name"] in album_pages]
            if sp_pages:
                pages = [pg for pg in pages if pg["name"] not in album_pages]
                credits_parts.extend(pg["text"] for pg in sp_pages if pg["text"].strip())
                print(f"  ◈ SP 专辑级页 {len(sp_pages)} 张 → credits", file=sys.stderr)

    booklet_text = "\n\n".join(f"# === {p['name']} ({p['kind']}) ===\n{p['text']}" for p in pages)
    credits_text = "\n\n".join(credits_parts) or booklet_text

    # 不做专辑级 LLM 校对：校对模型的「只输出歌词正文」人设会把标题/credits/
    # 碎片行当杂质删掉（实测 24 页混合文本被压缩到 1/4，分轨因此只剩 1 轨），
    # 而拼音对齐本就容忍字符级 OCR 错字——校对的价值远小于其破坏

    # 3) 音频轨单：agent 按歌曲本身名称排序/重命名，非曲目音频剔除；伴奏/无人声轨
    #    保留在轨单里（标记 inst=True，文件名强制原样保留），只是不送去转写
    #    （轨单以音频为权威）
    tracks_plan: list[dict] = []
    keep: set[str] = set()
    inst_files: set[str] = set()
    if buckets["audio"]:
        tracks_plan = org_mod.llm_order_tracks([p.name for p in buckets["audio"]], album)
        org_mod.apply_inst_overrides(tracks_plan, inst_marked, inst_as_song)
        keep = {t.get("file") for t in tracks_plan}
        inst_files = {t.get("file") for t in tracks_plan if t.get("inst")}
        skipped = [p.name for p in buckets["audio"] if p.name not in keep]
        if skipped:
            print(f"  ⏭ 轨单剔除 {len(skipped)} 个音轨（未识别为曲目）: {skipped}", file=sys.stderr)
        if inst_files:
            print(f"  ○ 轨单保留但不转写 {len(inst_files)} 个伴奏/无人声轨: {sorted(inst_files)}",
                  file=sys.stderr)
        # LRC 与同名音频的文件名绑定不依赖 LLM。这样 STT 只能补充该 LRC 的
        # 逐字侧车，不会因模糊匹配失败而改走自动生成歌词。
        by_stem = {Path(t["file"]).stem.casefold(): t["file"] for t in tracks_plan if t.get("file")}
        for track in tracks_explicit:
            if not track.get("authoritative_lrc"):
                continue
            stem = str(track.get("_source_stem") or "").casefold()
            if stem in by_stem:
                track["file"] = by_stem[stem]

    # 4) 音频 → 词级时间戳（云端 whisper-1 并发；伴奏/无人声轨没有人声可转写，跳过）
    audio_words: dict[str, list] = {}
    audio_langs: dict[str, str] = {}
    stt_cleanup: dict[str, dict] = {}
    if buckets["audio"]:
        from concurrent.futures import ThreadPoolExecutor
        kept = [a for a in buckets["audio"] if (not keep or a.name in keep) and a.name not in inst_files]
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(stt_mod.transcribe_words, kept))
        for a, (words, lang, cleanup) in zip(kept, results):
            if cleanup.get("removed_word_count"):
                stt_cleanup[a.name] = cleanup
            if lyrics_mod.is_chinese_language(lang):
                words = [{**word, "text": lyrics_mod.to_simplified(str(word.get("text", "")))} for word in words]
            audio_words[a.name] = words
            audio_langs[a.name] = lang

        # 语言重试：检测专辑主语言，对语言离群轨重跑 STT
        if len(audio_langs) > 1:
            lang_counts: dict[str, int] = {}
            for lg in audio_langs.values():
                lang_counts[lg] = lang_counts.get(lg, 0) + 1
            majority_lang = max(lang_counts, key=lambda k: lang_counts[k])
            retry_audios = [
                a for a in buckets["audio"]
                if a.name in audio_langs and audio_langs[a.name] != majority_lang
            ]
            if retry_audios:
                print(
                    f"  ↺ 语言重试（主语言={majority_lang}，重试 {len(retry_audios)} 首）："
                    f" {[a.name for a in retry_audios]}",
                    file=sys.stderr,
                )
                for a in retry_audios:
                    words, lang, cleanup = stt_mod.transcribe_words(a, lang=majority_lang)
                    if cleanup.get("removed_word_count"):
                        stt_cleanup[a.name] = cleanup
                    if lyrics_mod.is_chinese_language(lang):
                        words = [{**word, "text": lyrics_mod.to_simplified(str(word.get("text", "")))} for word in words]
                    audio_words[a.name] = words
                    audio_langs[a.name] = lang

    # 5) 整理 + 对齐 → res/<专辑>/（meta 全自动；专辑名 = 文件夹名 album）
    #    可选：若投递目录恰含 manifest.toml 则作为 meta 覆盖（非必需，不鼓励）。
    # 音频 tag 权威元信息：优先级仅次于 manifest（manifest 显式键覆盖 tag）
    tag_meta, source_hint = extract_audio_meta(buckets["audio"])
    manifest = {**tag_meta, **manifest}

    # 增补检测：若目标专辑已存在于 res_dir，进入增补模式
    existing_meta: dict | None = None
    if album:
        existing_dir = res_dir / album
        if existing_dir.is_dir():
            meta_path = existing_dir / "meta.toml"
            existing_meta = org_mod._read_toml(meta_path) if meta_path.is_file() else {}
            print(f"  🔄 检测到已有专辑「{album}」，进入增补模式", file=sys.stderr)

    # 增补模式允许 manifest/cover-only 提交；新建模式需要实质内容
    has_content = (tracks_explicit or booklet_text or audio_words
                   or (existing_meta is not None and (manifest or cover)))
    if not has_content:
        summary.update({"album": album, "result": "empty"})
        print(f"⚠️  专辑「{album}」无可整理素材", file=sys.stderr)
        return summary

    draft = org_mod.build_draft(
        tracks_explicit=tracks_explicit, booklet_text=booklet_text, credits_text=credits_text,
        audio_words=audio_words, audio_langs=audio_langs, tracks_plan=tracks_plan,
        pages=pages, image_paths=image_paths, photo_links=photo_links,
        manifest=manifest, source_hint=source_hint,
        album_override=album, cover_path=cover, existing_meta=existing_meta,
        default_lyric_maker=lyric_maker,
        stt_cleanup=stt_cleanup,
    )

    # Phase A：把成品草稿落成 review bundle（停在待人工闸门），不写 res
    if mode == "phase_a":
        bundle_dir = Path(bundle_root) / _album_slug(draft["album"])
        review_mod.write_bundle(bundle_dir, draft, timestamp=timestamp,
                                extra={"is_update": existing_meta is not None,
                                       "contributor": contributor})
        summary.update({"album": draft["album"], "phase": review_mod.STATUS_A_DONE,
                        "bundle": str(bundle_dir), "cover": cover.name if cover else None,
                        "is_update": existing_meta is not None, "result": "ok"})
        return summary

    # oneshot：直接对齐落盘
    org_res = org_mod.finalize(draft, res_dir=res_dir, dry_run=dry_run)
    summary.update({"album": org_res["album"], "written": org_res["written"],
                    "track_count": org_res["track_count"], "matched": org_res["matched"],
                    "avg_coverage": org_res["avg_coverage"], "cover": cover.name if cover else None,
                    "is_update": existing_meta is not None, "result": "ok"})
    return summary


def run_phase_a(src: Path, res_dir: Path, work: Path, album: str, bundle_root: Path,
                timestamp: str = "", dry_run: bool = False, lyric_maker: str = "",
                contributor: str = "") -> dict:
    """Phase A：逐专辑 OCR/STT/检索/建草稿/对齐 → review bundle（停在待人工闸门，不写 res）。"""
    work.mkdir(parents=True, exist_ok=True)
    bundle_root = Path(bundle_root)
    bundle_root.mkdir(parents=True, exist_ok=True)
    jobs = _resolve_jobs(src, album)
    print(f"识别到 {len(jobs)} 张专辑：{[a for a, _ in jobs]}", file=sys.stderr)
    albums_out = [
        _process_album(name, asrc, res_dir, work, dry_run, lyric_maker,
                       mode="phase_a", bundle_root=bundle_root, timestamp=timestamp,
                       contributor=contributor)
        for name, asrc in jobs
    ]
    ok = any(a.get("result") == "ok" for a in albums_out)
    done = [a for a in albums_out if a.get("result") == "ok"]
    return {"albums": albums_out, "result": "ok" if ok else "empty",
            "album": "、".join(a.get("album", "") for a in done if a.get("album")),
            "is_update": any(a.get("is_update") for a in done),
            "bundles": [a.get("bundle") for a in done if a.get("bundle")]}


def _find_bundles(bundle_root: Path) -> list[Path]:
    """bundle_root 本身或其直接子目录中含 draft.json 者 = 一张待 finalize 的专辑。"""
    bundle_root = Path(bundle_root)
    if (bundle_root / "draft.json").is_file():
        return [bundle_root]
    if not bundle_root.is_dir():
        return []
    return [p for p in sorted(bundle_root.iterdir()) if p.is_dir() and (p / "draft.json").is_file()]


def run_phase_b(bundle_root: Path, res_dir: Path, dry_run: bool = False) -> dict:
    """Phase B：读（可能被人工闸门校正过的）bundle → organize.finalize → res/<专辑>/。"""
    bundles = _find_bundles(bundle_root)
    if not bundles:
        print(f"⚠️  bundle 根下无 draft.json：{bundle_root}", file=sys.stderr)
        return {"albums": [], "result": "empty", "album": "", "is_update": False, "written": []}
    albums_out = []
    for bd in bundles:
        draft = review_mod.read_bundle(bd)
        status = review_mod.read_status(bd)
        org_res = org_mod.finalize(draft, res_dir=res_dir, dry_run=dry_run)
        albums_out.append({"album": org_res["album"], "written": org_res["written"],
                           "track_count": org_res["track_count"], "matched": org_res["matched"],
                           "avg_coverage": org_res["avg_coverage"],
                           "is_update": bool(status.get("is_update")), "result": "ok"})
        print(f"✓ Phase B 完成：{org_res['album']}（{org_res['track_count']} 轨）", file=sys.stderr)
    ok = any(a["result"] == "ok" for a in albums_out)
    done = [a for a in albums_out if a["result"] == "ok"]
    return {"albums": albums_out, "result": "ok" if ok else "empty",
            "album": "、".join(a["album"] for a in done if a["album"]),
            "is_update": any(a.get("is_update") for a in done),
            "written": [w for a in albums_out for w in a.get("written", [])]}


def _order_from_name(stem: str) -> int:
    m = re.match(r"\s*(\d+)", stem)
    return int(m.group(1)) if m else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="upload 摄取管道单入口")
    ap.add_argument("--phase", choices=["oneshot", "a", "b"], default="oneshot",
                    help="oneshot=一次性(默认)；a=Phase A 建 review bundle；b=Phase B 读 bundle 落盘")
    ap.add_argument("--src", help="投递目录（oneshot/a 必填）")
    ap.add_argument("--bundle-root", help="review bundle 根目录（a 写、b 读）")
    ap.add_argument("--timestamp", default="", help="Phase A 写入 status 的时间戳（由 workflow 传 date -u）")
    ap.add_argument("--contributor", default="", help="Phase A 写入 status 的投稿者（供 Phase B 开 PR 署名）")
    ap.add_argument("--res-dir", default="res")
    ap.add_argument("--work", default=".ingest_work")
    ap.add_argument("--album", default="")
    ap.add_argument("--json", help="把摘要写入该 JSON 文件")
    ap.add_argument("--lyric-maker", default="", help="歌词制作默认署名（lyric_maker 为空时填入）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    if args.phase == "b":
        if not args.bundle_root:
            print("Phase B 需要 --bundle-root", file=sys.stderr)
            return 1
        summary = run_phase_b(Path(args.bundle_root), Path(args.res_dir), args.dry_run)
    else:
        if not args.src or not Path(args.src).is_dir():
            print(f"投递目录不存在: {args.src}", file=sys.stderr)
            return 1
        src = Path(args.src)
        if args.phase == "a":
            if not args.bundle_root:
                print("Phase A 需要 --bundle-root", file=sys.stderr)
                return 1
            summary = run_phase_a(src, Path(args.res_dir), Path(args.work), args.album,
                                  Path(args.bundle_root), args.timestamp, args.dry_run,
                                  args.lyric_maker, args.contributor)
        else:
            summary = run(src, Path(args.res_dir), Path(args.work), args.album,
                          args.dry_run, args.lyric_maker)

    if args.json:
        Path(args.json).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary.get("result") in ("ok", "empty") else 1


if __name__ == "__main__":
    raise SystemExit(main())
