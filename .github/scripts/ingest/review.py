#!/usr/bin/env python3
"""ingest/review.py — Phase A 草稿(draft) ⇄ review bundle 目录 的序列化。

Phase A 用 write_bundle 把 build_draft 的 draft 落成一组文件（供 workflow git push
到 ingest-review/<ref>/ 与人工闸门面板读写）；Phase B 用 read_bundle 从（可能被
人工闸门校正过的）bundle 目录重建 draft 喂给 organize.finalize。

bundle 布局（<ref>/ 下）：
  status.json  — {phase, album, is_update, created, updated, ...}
  draft.json   — album/tracks/meta/names/pages/cover_ext（人工闸门可编辑对象；不含词流）
  stt.json     — {audio_name: {lang, words}} 词级时间戳（对齐用，面板不加载不编辑）
  cover.<ext>  — 封面二进制（可选）

只做本地目录 ⇄ draft 的序列化，不碰 git（push/checkout 由 workflow 做），也不取
时间（timestamp 由调用方传入，保持纯函数与可测）。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

STATUS_A_DONE = "A_done"        # Phase A 完成，待人工闸门
STATUS_CONFIRMED = "confirmed"  # 人工已确认（或一键放行），待 Phase B
STATUS_B_DONE = "B_done"        # Phase B 完成，待清理

# 人工闸门可编辑的 draft 字段（词流/本机 cover_path 不在其列）
_EDITABLE_KEYS = ("album", "tracks", "meta", "names", "pages")


def _split_stt(draft: dict) -> dict:
    """draft 的 audio_words + audio_langs → {audio_name: {lang, words}}。"""
    aw = draft.get("audio_words") or {}
    al = draft.get("audio_langs") or {}
    return {name: {"lang": al.get(name, ""), "words": words} for name, words in aw.items()}


def write_bundle(bundle_dir: Path, draft: dict, *, status: str = STATUS_A_DONE,
                 timestamp: str = "", extra: dict | None = None) -> dict:
    """把 draft 落成 bundle 文件到 bundle_dir。返回写出的 status 文档。"""
    bundle_dir.mkdir(parents=True, exist_ok=True)

    # 封面：拷成 cover.<ext>，draft.json 只留 ext（跨进程后 cover_path 不再有效）
    cover_ext = ""
    cover_path = draft.get("cover_path")
    if cover_path and Path(cover_path).is_file():
        cover_ext = Path(cover_path).suffix.lower() or ".png"
        shutil.copyfile(cover_path, bundle_dir / f"cover{cover_ext}")

    editable = {k: draft.get(k, [] if k in ("tracks", "pages") else {}) for k in _EDITABLE_KEYS}
    editable["album"] = draft.get("album", "")
    editable["cover_ext"] = cover_ext
    (bundle_dir / "draft.json").write_text(
        json.dumps(editable, ensure_ascii=False, indent=2), encoding="utf-8")

    (bundle_dir / "stt.json").write_text(
        json.dumps(_split_stt(draft), ensure_ascii=False), encoding="utf-8")

    status_doc = {"phase": status, "album": draft.get("album", ""),
                  "created": timestamp, "updated": timestamp}
    if extra:
        status_doc.update(extra)
    (bundle_dir / "status.json").write_text(
        json.dumps(status_doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return status_doc


def read_bundle(bundle_dir: Path) -> dict:
    """从 bundle_dir 重建完整 draft（词流塞回、cover_path 指向本地文件）。"""
    editable = json.loads((bundle_dir / "draft.json").read_text(encoding="utf-8"))
    stt_path = bundle_dir / "stt.json"
    stt = json.loads(stt_path.read_text(encoding="utf-8")) if stt_path.is_file() else {}

    cover_ext = editable.get("cover_ext", "")
    cover_file = bundle_dir / f"cover{cover_ext}" if cover_ext else None
    cover_path = str(cover_file) if cover_file and cover_file.is_file() else None

    return {
        "album": editable.get("album", ""),
        "tracks": editable.get("tracks", []),
        "meta": editable.get("meta", {}),
        "names": editable.get("names", {}),
        "pages": editable.get("pages", []),
        "audio_words": {name: v.get("words", []) for name, v in stt.items()},
        "audio_langs": {name: v.get("lang", "") for name, v in stt.items()},
        "cover_path": cover_path,
    }


def read_status(bundle_dir: Path) -> dict:
    p = bundle_dir / "status.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
