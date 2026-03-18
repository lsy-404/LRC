"""fill_staff_from_desc.py — 从 Bilibili 视频简介中提取 STAFF 元数据并回写 meta.toml

流程
────
1. 扫描所有专辑，找出「有 Bilibili 发布链接 + 存在空 STAFF 字段」的专辑
2. 拉取对应视频简介（fetch_video_detail）
3. 将简介原文送入 LLM，解析出 STAFF 字段
4. 展示 LLM 解析结果，交互确认后合并写入 meta.toml（仅填充空字段）

用法
────
# 预览所有专辑（不写入）
python .github/scripts/fill_staff_from_desc.py --dry-run

# 处理指定专辑
python .github/scripts/fill_staff_from_desc.py --album "依睐·幻想曲"

# 全自动（直接写入 LLM 解析结果，不弹交互）
python .github/scripts/fill_staff_from_desc.py --auto

# 仅打印简介内容，不调用 LLM
python .github/scripts/fill_staff_from_desc.py --show-desc
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional

# Windows UTF-8 输出（使用 reconfigure 避免重定向场景下的 buffer 问题）
if sys.platform == "win32":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, io.UnsupportedOperation):
            pass

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from lib.config_loader import load_config
from lib.meta_parser import load_album_meta
from lib.llm_client import create_llm_client_from_config
from fetch_bilibili_meta import fetch_video_detail, serialize_meta

CONFIG     = load_config()
PROJECT    = CONFIG.get("project", {})
META_CFG   = CONFIG.get("meta", {})
LLM_CFG    = CONFIG.get("llm", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR  = ROOT_DIR / str(PROJECT.get("res_dir", "res"))

# STAFF 内部字段名
STAFF_FIELDS = ["vocal", "lyricist", "composer", "arranger", "tuning", "illustrator", "mixer"]

# 字段显示名（internal → 中文标签）
FIELD_LABELS = {
    "vocal":       "演唱",
    "lyricist":    "作词",
    "composer":    "作曲",
    "arranger":    "编曲",
    "tuning":      "调校",
    "illustrator": "曲绘",
    "mixer":       "混音",
}

BV_RE = re.compile(r'BV[A-Za-z0-9]+')


# ──────────────────────────────────────────────────────────────────────────────
# 辅助
# ──────────────────────────────────────────────────────────────────────────────

def get_bvid(release: str) -> Optional[str]:
    """从 release 字段提取 BV 号。"""
    m = BV_RE.search(release)
    return m.group() if m else None


def missing_staff(meta: dict[str, Any]) -> list[str]:
    """返回当前为空的 STAFF 字段列表。"""
    return [f for f in STAFF_FIELDS if not (meta.get(f) or [])]


def _yn(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() == "y"
    except (EOFError, KeyboardInterrupt):
        return False


# ──────────────────────────────────────────────────────────────────────────────
# 合并写入
# ──────────────────────────────────────────────────────────────────────────────

def apply_staff(
    meta: dict[str, Any],
    extracted: dict[str, list[str]],
    missing: list[str],
) -> tuple[dict[str, Any], list[str]]:
    """
    将 LLM 提取结果合并到 meta（仅覆盖空字段）。
    返回 (new_meta, changes) 其中 changes 是变更描述列表。
    """
    new_meta = dict(meta)
    changes: list[str] = []

    for field, names in extracted.items():
        if field not in missing:
            continue  # 该字段已有值，跳过
        if names:
            new_meta[field] = names
            label = FIELD_LABELS.get(field, field)
            changes.append(f"{label} = {names}")

    return new_meta, changes


# ──────────────────────────────────────────────────────────────────────────────
# 处理单张专辑
# ──────────────────────────────────────────────────────────────────────────────

def process_album(
    album_dir: Path,
    llm_client,
    dry_run: bool = False,
    auto: bool = False,
    show_desc: bool = False,
    verbose: bool = False,
) -> bool:
    """处理单张专辑，返回 True 表示发生写入。"""
    album_name = album_dir.name
    meta, meta_path = load_album_meta(album_dir)

    release = str(meta.get("release") or "").strip()
    if not release:
        if verbose:
            print(f"  [跳过] {album_name}（无发布链接）")
        return False

    bvid = get_bvid(release)
    if not bvid:
        if verbose:
            print(f"  [跳过] {album_name}（无法从发布字段提取 BV 号）")
        return False

    missing = missing_staff(meta)
    if not missing:
        if verbose:
            print(f"  [跳过] {album_name}（STAFF 字段已齐全）")
        return False

    print(f"\n{'─'*62}")
    print(f"  专辑: {album_name}")
    print(f"  BV号: {bvid}")
    print(f"  缺少: {[FIELD_LABELS.get(f, f) for f in missing]}")

    # ── 拉取简介 ────────────────────────────────
    print("  正在拉取视频简介…")
    detail = fetch_video_detail(bvid)
    desc = detail.get("desc", "").strip()

    if not desc:
        print("  [跳过] 视频简介为空")
        return False

    # ── 展示简介 ─────────────────────────────────
    print(f"\n  ┌─ 视频简介（{len(desc)} 字）─────────────────────────")
    for line in desc.splitlines()[:40]:
        print(f"  │ {line}")
    if len(desc.splitlines()) > 40:
        print(f"  │ … （共 {len(desc.splitlines())} 行）")
    print("  └───────────────────────────────────────────────")

    if show_desc:
        return False  # 仅展示，不继续

    # ── LLM 提取 ─────────────────────────────────
    if not llm_client:
        print("  [跳过] LLM 未配置（请设置 LLM_API_KEY 环境变量）")
        return False

    zh_name = str(meta.get("zh_name") or "").strip() or album_name
    print(f"\n  正在调用 LLM 解析 STAFF…")
    extracted = llm_client.extract_staff_from_desc(desc, zh_name, missing)

    if not extracted:
        print("  [LLM] 未提取到任何 STAFF 信息")
        return False

    # ── 展示提取结果 ──────────────────────────────
    print("\n  ── LLM 提取结果 ──")
    for field in STAFF_FIELDS:
        if field not in extracted:
            continue
        label = FIELD_LABELS.get(field, field)
        names = extracted[field]
        status = "（空字段→填充）" if field in missing else "（已有值→跳过）"
        print(f"    {label:<4}: {', '.join(names)}  {status}")

    # ── 确认并写入 ────────────────────────────────
    new_meta, changes = apply_staff(meta, extracted, missing)

    if not changes:
        print("  [无更新] LLM 结果与已有数据无差异")
        return False

    print("\n  变更：")
    for c in changes:
        print(f"    + {c}")

    if not auto and not dry_run:
        if not _yn("\n  写入以上变更？[y/N]: "):
            print("  [跳过] 用户取消")
            return False

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
        description="从 Bilibili 视频简介提取 STAFF 元数据并回写 meta.toml"
    )
    parser.add_argument("--album",     metavar="NAME", help="仅处理指定专辑文件夹名")
    parser.add_argument("--dry-run",   action="store_true", help="预览，不写入")
    parser.add_argument("--auto",      action="store_true", help="自动写入，不弹确认")
    parser.add_argument("--show-desc", action="store_true", help="仅展示简介，不调用 LLM")
    parser.add_argument("--verbose",   action="store_true", help="显示跳过的专辑")
    args = parser.parse_args()

    if not RES_DIR.exists():
        print(f"[ERROR] 找不到资源目录：{RES_DIR}", file=sys.stderr)
        sys.exit(1)

    llm_client = None
    if not args.show_desc:
        llm_client = create_llm_client_from_config(LLM_CFG)
        if not llm_client:
            print("[WARN] LLM 未配置，将只展示简介内容")

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
    if args.show_desc:  tags.append("SHOW-DESC")
    mode_str = f"[{'/'.join(tags)}] " if tags else ""
    print(f"{mode_str}开始处理 {len(album_dirs)} 张专辑…\n")

    updated = 0
    for album_dir in album_dirs:
        try:
            if process_album(
                album_dir,
                llm_client=llm_client,
                dry_run=args.dry_run,
                auto=args.auto,
                show_desc=args.show_desc,
                verbose=args.verbose,
            ):
                updated += 1
        except KeyboardInterrupt:
            print("\n[中断]")
            break
        except Exception as e:
            print(f"\n  [ERROR] {album_dir.name}: {e}", file=sys.stderr)
            if args.verbose:
                import traceback; traceback.print_exc()
        finally:
            time.sleep(0.5)  # 避免请求过快

    print(f"\n{'─'*62}")
    action = "预览" if args.dry_run else ("展示" if args.show_desc else "已更新")
    print(f"完成。{len(album_dirs)} 张专辑，{updated} 张{action}。")


if __name__ == "__main__":
    main()
