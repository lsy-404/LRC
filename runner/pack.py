"""专辑压缩包重建：按内容哈希判断过期，替代原先靠 git 历史比对的增量检测。

打包内容与站点下载入口一致：歌词(.lrc/.elrc)、文本(.txt)、meta.toml、封面。
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

INDEX_NAME = ".index.json"
_EXTS = (".lrc", ".elrc", ".txt")


def _members(album_dir: Path) -> list[Path]:
    out = []
    for p in sorted(album_dir.iterdir()):
        if not p.is_file():
            continue
        if p.suffix.lower() in _EXTS or p.name == "meta.toml" or p.stem.lower() == "cover":
            out.append(p)
    return out


def album_hash(album_dir: Path) -> str:
    h = hashlib.sha256()
    for p in _members(album_dir):
        h.update(p.name.encode("utf-8"))
        h.update(b"\0")
        h.update(hashlib.sha256(p.read_bytes()).digest())
    return h.hexdigest()


def _write_zip(album_dir: Path, zip_path: Path) -> int:
    members = _members(album_dir)
    if not members:
        return 0
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = zip_path.with_suffix(".zip.tmp")
    # 固定时间戳：包内容只随源文件变化，同样的歌词不会因重跑产生新字节而白占提交
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in members:
            info = zipfile.ZipInfo(p.name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, p.read_bytes())
    tmp.replace(zip_path)
    return len(members)


def _matches_existing(album_dir: Path, zip_path: Path) -> bool:
    """现有包的成员名与解压后大小是否与目录一致。

    只在索引缺失（首次运行）时用来认领既有包，免得把全部专辑重打一遍——
    此前包是否过期由 git 历史判断，那套信息迁移后不再可得。
    """
    if not zip_path.is_file():
        return False
    try:
        with zipfile.ZipFile(zip_path) as zf:
            packed = {i.filename: i.file_size for i in zf.infolist()}
    except (zipfile.BadZipFile, OSError):
        return False
    return packed == {p.name: p.stat().st_size for p in _members(album_dir)}


def rebuild(res_dir: Path, pack_dir: Path, *, force: bool = False) -> dict:
    """比对哈希索引重建过期的包，清理无主的包。返回 {built, removed, skipped}。"""
    pack_dir.mkdir(parents=True, exist_ok=True)
    index_path = pack_dir / INDEX_NAME
    index = {}
    seeding = False
    if index_path.is_file():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except ValueError:
            index = {}
    else:
        seeding = True

    built, skipped = [], []
    albums = sorted(p for p in res_dir.iterdir() if p.is_dir()) if res_dir.is_dir() else []
    for album_dir in albums:
        name = album_dir.name
        digest = album_hash(album_dir)
        zip_path = pack_dir / f"{name}.zip"
        if not force and seeding and _matches_existing(album_dir, zip_path):
            index[name] = digest
            skipped.append(name)
            continue
        if not force and zip_path.is_file() and index.get(name) == digest:
            skipped.append(name)
            continue
        if _write_zip(album_dir, zip_path):
            index[name] = digest
            built.append(name)

    live = {p.name for p in albums}
    removed = []
    for zip_path in sorted(pack_dir.glob("*.zip")):
        if zip_path.stem not in live:
            zip_path.unlink()
            index.pop(zip_path.stem, None)
            removed.append(zip_path.stem)
    for name in list(index):
        if name not in live:
            index.pop(name)

    index_path.write_text(json.dumps(index, ensure_ascii=False, sort_keys=True, indent=1),
                          encoding="utf-8")
    return {"built": built, "removed": removed, "skipped": len(skipped)}
