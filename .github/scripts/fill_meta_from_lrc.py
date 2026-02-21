"""fill_meta_from_lrc.py — 从 LRC 提取元数据并回写完整 meta.toml

策略
────
1. 读取专辑现有 meta.toml（如不存在则以全空默认值初始化）
2. 从该专辑所有 LRC 文件提取元数据
3. 合并规则：
   - 列表字段（演唱/作词/作曲/编曲/调校/曲绘/混音）：
       meta.toml 有值 → 保留；空 → 用 LRC 提取结果填入
   - 字符串字段（发行日期/出品/…）：LRC 无法提取，保留原值
4. 写回 meta.toml，**始终输出所有字段**（即使为空列表/空字符串）

输出格式（自定义 TOML-like，与 meta_parser.py 兼容）
    发行日期 = ""
    演唱 = ["A", "B"]
    编曲 = []

用法
────
# 处理全部专辑（仅修改有变化的文件）
python .github/scripts/fill_meta_from_lrc.py

# 仅处理指定专辑
python .github/scripts/fill_meta_from_lrc.py --album "丛林法则Jungle Rules"

# 预览，不实际写入
python .github/scripts/fill_meta_from_lrc.py --dry-run

# 详细日志
python .github/scripts/fill_meta_from_lrc.py --verbose
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path
from typing import Any

# Windows UTF-8 输出
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from lib.lrc_meta_extractor import merge_album_lrc_metadata
from lib.config_loader import load_config
from lib.meta_parser import load_album_meta

CONFIG = load_config()
META_CONFIG = CONFIG.get("meta", {})
PROJECT = CONFIG.get("project", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))

# ──────────────────────────────────────────────────────────────────────────────
# 字段定义：canonical 内部名称 → (TOML 中文键, 类型)
# ──────────────────────────────────────────────────────────────────────────────
FIELD_SCHEMA: list[tuple[str, str, str]] = [
    (str(item.get("internal", "")), str(item.get("toml_key", "")), str(item.get("type", "str")))
    for item in META_CONFIG.get("field_schema", [])
    if item.get("internal") and item.get("toml_key")
]

# 可从 LRC 提取的字段（包括列表字段和lyric_maker字符串字段）
_LRC_FILLABLE = set(META_CONFIG.get("lrc_fillable", ["vocal", "lyricist", "composer", "arranger", "tuning", "illustrator", "mixer", "lyric_maker"]))


# ──────────────────────────────────────────────────────────────────────────────
# TOML 格式化写入
# ──────────────────────────────────────────────────────────────────────────────

def _fmt_str(value: str) -> str:
    """将字符串值格式化为 TOML 字符串字面量（保留内嵌引号，使用双引号包裹）。"""
    # 若值本身含双引号，转义；若含换行，也转义
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{escaped}"'


def _fmt_list(values: list[str]) -> str:
    """将字符串列表格式化为 TOML 数组。"""
    if not values:
        return "[]"
    items = ", ".join(_fmt_str(v) for v in values)
    return f"[{items}]"


def serialize_meta(meta: dict[str, Any]) -> str:
    """按 FIELD_SCHEMA 顺序将完整元数据序列化为 TOML 字符串。"""
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
# 合并逻辑
# ──────────────────────────────────────────────────────────────────────────────

def merge(existing: dict[str, Any], lrc: dict[str, Any]) -> dict[str, Any]:
    """
    合并现有 meta.toml 数据与 LRC 提取结果。

    规则：
    - 列表字段：meta.toml 非空则保留；空则使用 LRC 结果（可能仍为空）
    - 字符串字段（除lyric_maker外）：始终保留 meta.toml 的值（LRC 无法提供）
    - lyric_maker字段：meta.toml 非空则保留；空则使用 LRC 结果
    """
    merged: dict[str, Any] = {}
    for internal, _toml_key, typ in FIELD_SCHEMA:
        if typ == "list":
            ex = existing.get(internal) or []
            if isinstance(ex, list) and ex:
                merged[internal] = ex          # meta.toml 有值→保留
            elif internal in _LRC_FILLABLE:
                merged[internal] = lrc.get(internal) or []  # 用 LRC 填充
            else:
                merged[internal] = []
        else:
            # 字符串字段
            ex_val = existing.get(internal) or ""
            if ex_val:
                merged[internal] = ex_val  # meta.toml 有值→保留
            elif internal in _LRC_FILLABLE:
                merged[internal] = lrc.get(internal) or ""  # 用 LRC 填充
            else:
                merged[internal] = ""
    return merged


# ──────────────────────────────────────────────────────────────────────────────
# 处理单张专辑
# ──────────────────────────────────────────────────────────────────────────────

def process_album(
    album_dir: Path,
    dry_run: bool = False,
    verbose: bool = False,
) -> bool:
    """
    处理单张专辑。返回 True 表示 meta.toml 实际被写入（发生变化）。
    """
    lrc_files = sorted(album_dir.glob("*.lrc"))
    existing_meta, meta_path = load_album_meta(album_dir)

    # 从 LRC 提取
    lrc_meta = merge_album_lrc_metadata(lrc_files)

    # 合并
    merged = merge(existing_meta, lrc_meta)

    # 序列化
    new_content = serialize_meta(merged)

    # 确定写入目标
    target = meta_path if meta_path else (album_dir / "meta.toml")

    # 检查是否有变化（避免无谓写入）
    changed = True
    if target.exists():
        old_content = target.read_text(encoding="utf-8")
        changed = old_content.strip() != new_content.strip()

    if verbose:
        status = "[changed]" if changed else "[unchanged]"
        print(f"  {status} {album_dir.name}")
        for internal, toml_key, typ in FIELD_SCHEMA:
            val = merged.get(internal)
            if typ == "list":
                display = "、".join(val) if val else "(空)"
            else:
                display = val if val else "(空)"
            lrc_had = bool(lrc_meta.get(internal))
            ex_had = bool(existing_meta.get(internal))
            source = ""
            if typ == "list":
                if ex_had:
                    source = " [来自meta.toml]"
                elif lrc_had:
                    source = " [来自LRC]"
                else:
                    source = " [空默认]"
            print(f"    {toml_key:<6} = {display}{source}")

    if changed and not dry_run:
        target.write_text(new_content, encoding="utf-8")

    return changed


# ──────────────────────────────────────────────────────────────────────────────
# 主入口
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="从 LRC 文件提取元数据并回写完整 meta.toml（始终输出全字段）"
    )
    parser.add_argument("--album", metavar="NAME", help="仅处理指定专辑文件夹名")
    parser.add_argument("--dry-run", action="store_true", help="预览但不实际写入")
    parser.add_argument("--verbose", action="store_true", help="输出每个字段的来源和值")
    args = parser.parse_args()

    if not RES_DIR.exists():
        print(f"[ERROR] 找不到资源目录：{RES_DIR}", file=sys.stderr)
        sys.exit(1)

    if args.album:
        album_dirs = [RES_DIR / args.album]
        if not album_dirs[0].is_dir():
            print(f"[ERROR] 专辑目录不存在：{album_dirs[0]}", file=sys.stderr)
            sys.exit(1)
    else:
        album_dirs = sorted([d for d in RES_DIR.iterdir() if d.is_dir()])

    mode = "[DRY-RUN] " if args.dry_run else ""
    print(f"{mode}开始处理 {len(album_dirs)} 张专辑...\n")

    changed_count = 0
    for album_dir in album_dirs:
        changed = process_album(album_dir, dry_run=args.dry_run, verbose=args.verbose)
        if changed:
            changed_count += 1
            if not args.verbose:
                marker = "[preview]" if args.dry_run else "[updated]"
                print(f"  {marker} {album_dir.name}")
        elif not args.verbose:
            print(f"  [=]       {album_dir.name}")

    print(f"\n完成。共 {len(album_dirs)} 张专辑，{changed_count} 张 meta.toml 已{'预览' if args.dry_run else '更新'}。")


if __name__ == "__main__":
    main()
