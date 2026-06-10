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
    manifest.toml          → 专辑名 + meta 覆盖
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
    from ingest import proofread as pf_mod
    from ingest import stt as stt_mod
    from ingest import organize as org_mod
    from ingest import lyrics as lyrics_mod
else:
    from . import ocr as ocr_mod
    from . import documents as doc_mod
    from . import proofread as pf_mod
    from . import stt as stt_mod
    from . import organize as org_mod
    from . import lyrics as lyrics_mod

TEXT_EXTS = {".txt"}
IGNORE_NAMES = {"manifest.toml", "readme.md", "readme.txt", ".gitkeep", ".ds_store"}
IGNORE_DIRS = {".git", ".github"}
COVER_HINT = re.compile(r"cover|封面|主视图|jacket|booklet", re.I)


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
    buckets: dict[str, list[Path]] = {"image": [], "doc": [], "audio": [], "text": [], "other": []}
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
        else:
            buckets["other"].append(p)
    return buckets


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Parse JPEG SOF marker to extract (width, height). Returns (0, 0) on failure."""
    i = 2  # skip SOI
    while i + 4 < len(data):
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC9, 0xCA, 0xCB):
            if i + 9 <= len(data):
                h = int.from_bytes(data[i + 5:i + 7], "big")
                w = int.from_bytes(data[i + 7:i + 9], "big")
                return w, h
        length = int.from_bytes(data[i + 2:i + 4], "big")
        i += 2 + length
    return 0, 0


def _image_is_square(path: Path) -> bool:
    """Return True if the image has equal width and height (pure stdlib, no deps)."""
    try:
        data = path.read_bytes()
        ext = path.suffix.lower()
        if ext in {".jpg", ".jpeg"}:
            w, h = _jpeg_dimensions(data)
        elif ext == ".png":
            if len(data) >= 24 and data[1:4] == b"PNG":
                w = int.from_bytes(data[16:20], "big")
                h = int.from_bytes(data[20:24], "big")
            else:
                return False
        elif ext == ".webp":
            if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
                return False
            chunk = data[12:16]
            if chunk == b"VP8 " and len(data) >= 30:
                w = int.from_bytes(data[26:28], "little") & 0x3FFF
                h = int.from_bytes(data[28:30], "little") & 0x3FFF
            elif chunk == b"VP8L" and len(data) >= 25:
                bits = int.from_bytes(data[21:25], "little")
                w = (bits & 0x3FFF) + 1
                h = ((bits >> 14) & 0x3FFF) + 1
            else:
                return False
        elif ext == ".bmp":
            if len(data) >= 26 and data[:2] == b"BM":
                w = int.from_bytes(data[18:22], "little")
                h = abs(int.from_bytes(data[22:26], "little", signed=True))
            else:
                return False
        else:
            return False
        return w > 0 and h > 0 and w == h
    except Exception:
        return False


def pick_cover(images: list[Path]) -> Path | None:
    if not images:
        return None
    named = [p for p in images if COVER_HINT.search(p.name)]
    pool = named or images
    # Prefer square images (album covers are almost always square); fall back to largest
    squares = [p for p in pool if _image_is_square(p)]
    if squares:
        return max(squares, key=lambda p: p.stat().st_size)
    return max(pool, key=lambda p: p.stat().st_size)


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


def run(src: Path, res_dir: Path, work: Path, album: str, dry_run: bool, lyric_maker: str = "") -> dict:
    """识别专辑（= 上传里的顶层文件夹名）并逐个处理。

    - 上传根下每个文件夹视为一张专辑，文件夹名即专辑名（无需 manifest）。
    - 若用 --album 显式指定，或根下无文件夹（素材直接在根），则整体当一张专辑。
    """
    work.mkdir(parents=True, exist_ok=True)
    if album:
        jobs = [(album, src)]
    else:
        album_dirs = find_album_dirs(src)
        if album_dirs:
            jobs = [(d.name, d) for d in album_dirs]
        else:
            jobs = [("", src)]  # 素材直接在根、又没给名字 → 专辑名待定
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


def _process_album(album: str, src: Path, res_dir: Path, work: Path, dry_run: bool, lyric_maker: str = "") -> dict:
    buckets = classify(src)
    summary: dict = {k: [p.name for p in v] for k, v in buckets.items()}
    print(f"分流：图片{len(buckets['image'])} 文档{len(buckets['doc'])} 音频{len(buckets['audio'])} "
          f"文字{len(buckets['text'])} 其他{len(buckets['other'])}", file=sys.stderr)

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

    # 2) 图片 OCR + 文档抽取 → 歌词本文本（无逐曲歌词时供 LLM 分轨；并供抽 credits）
    booklet_parts: list[str] = []
    cover = pick_cover(buckets["image"])
    ocr_images = [p for p in buckets["image"] if p != cover]  # 封面不做歌词 OCR
    if ocr_images:
        try:
            for name, t in ocr_mod.run(ocr_images).items():
                booklet_parts.append(f"# === {name} (OCR) ===\n{t}")
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  OCR 阶段异常: {e}", file=sys.stderr)
    if buckets["doc"]:
        try:
            for name, t in doc_mod.run(buckets["doc"]).items():
                booklet_parts.append(f"# === {name} (DOC) ===\n{t}")
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  文档阶段异常: {e}", file=sys.stderr)
    booklet_text = "\n\n".join(booklet_parts)
    credits_text = "\n\n".join(credits_parts) or booklet_text

    # 3) 音频 → 词级时间戳
    audio_words: dict[str, list] = {}
    if buckets["audio"]:
        try:
            model = stt_mod._load_model()
            for a in buckets["audio"]:
                try:
                    words, _ = stt_mod.transcribe_words(a, model=model)
                    audio_words[a.name] = words
                except Exception as e:  # noqa: BLE001
                    print(f"⚠️  STT 失败 {a.name}: {e}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  STT 模型加载失败: {e}", file=sys.stderr)

    # 4) 整理 + 对齐 → res/<专辑>/（meta 全自动；专辑名 = 文件夹名 album）
    #    可选：若投递目录恰含 manifest.toml 则作为 meta 覆盖（非必需，不鼓励）。
    manifest_path = src / "manifest.toml"
    manifest = org_mod._read_toml(manifest_path) if manifest_path.is_file() else {}

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

    org_res = org_mod.organize(
        tracks_explicit=tracks_explicit, booklet_text=booklet_text, credits_text=credits_text,
        audio_words=audio_words, manifest=manifest, res_dir=res_dir,
        album_override=album, cover_path=cover, existing_meta=existing_meta, dry_run=dry_run,
        default_lyric_maker=lyric_maker,
    )
    summary.update({"album": org_res["album"], "written": org_res["written"],
                    "track_count": org_res["track_count"], "matched": org_res["matched"],
                    "avg_coverage": org_res["avg_coverage"], "cover": cover.name if cover else None,
                    "is_update": existing_meta is not None, "result": "ok"})
    return summary


def _order_from_name(stem: str) -> int:
    m = re.match(r"\s*(\d+)", stem)
    return int(m.group(1)) if m else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="upload 摄取管道单入口")
    ap.add_argument("--src", required=True)
    ap.add_argument("--res-dir", default="res")
    ap.add_argument("--work", default=".ingest_work")
    ap.add_argument("--album", default="")
    ap.add_argument("--json", help="把摘要写入该 JSON 文件")
    ap.add_argument("--lyric-maker", default="", help="歌词制作默认署名（lyric_maker 为空时填入）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    src = Path(args.src)
    if not src.is_dir():
        print(f"投递目录不存在: {src}", file=sys.stderr)
        return 1

    summary = run(src, Path(args.res_dir), Path(args.work), args.album, args.dry_run, args.lyric_maker)
    if args.json:
        Path(args.json).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary.get("result") in ("ok", "empty") else 1


if __name__ == "__main__":
    raise SystemExit(main())
