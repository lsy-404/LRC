"""generate_meta.py — 从 LRC 提取元数据、推断专辑名称并生成完整 meta.toml

策略
────
1. 读取专辑现有 meta.toml（如不存在则以全空默认值初始化）
2. 从该专辑所有 LRC 文件提取元数据
3. 使用LLM或回退算法推断专辑名称（prefix, zh_name, en_name, suffix）
4. 合并规则：
   - 列表字段（演唱/作词/作曲/编曲/调校/曲绘/混音）：
       meta.toml 有值 → 保留；空 → 用 LRC 提取结果填入
   - 名称字段（prefix/zh_name/en_name/suffix）：
       meta.toml 有值 → 保留（除非 --force-names）；空 → 用推断结果填入
   - 字符串字段（发行日期/出品/…）：LRC 无法提取，保留原值
5. 写回 meta.toml，**始终输出所有字段**（即使为空列表/空字符串）

输出格式（自定义 TOML-like，与 meta_parser.py 兼容）
    发行日期 = ""
    演唱 = ["A", "B"]
    编曲 = []

用法
────
# 处理全部专辑（仅修改有变化的文件）
python .github/scripts/generate_meta.py

# 仅处理指定专辑
python .github/scripts/generate_meta.py --album "丛林法则Jungle Rules"

# 预览，不实际写入
python .github/scripts/generate_meta.py --dry-run

# 强制重新推断名称（覆盖现有值）
python .github/scripts/generate_meta.py --force-names

# 详细日志
python .github/scripts/generate_meta.py --verbose
"""

from __future__ import annotations

import json
import argparse
import io
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from lib.llm_client import create_llm_client_from_config

CONFIG = load_config()
META_CONFIG = CONFIG.get("meta", {})
PROJECT = CONFIG.get("project", {})
LLM_CONFIG = CONFIG.get("llm", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))

# 初始化LLM客户端
LLM_CLIENT = create_llm_client_from_config(LLM_CONFIG)

# 线程锁用于输出同步
_PRINT_LOCK = threading.Lock()

# ──────────────────────────────────────────────────────────────────────────────
# 字段定义：canonical 内部名称 → (TOML 中文键, 类型)
# ──────────────────────────────────────────────────────────────────────────────
FIELD_SCHEMA: list[tuple[str, str, str]] = [
    (str(item.get("internal", "")), str(item.get("toml_key", "")), str(item.get("type", "str")))
    for item in META_CONFIG.get("field_schema", [])
    if item.get("internal") and item.get("toml_key")
]

# 可从 LRC 提取的字段（所有列表字段）
_LRC_FILLABLE = set(META_CONFIG.get("lrc_fillable", ["vocal", "lyricist", "composer", "arranger", "tuning", "illustrator", "mixer", "lyric_maker"]))

# 名称字段
_NAME_FIELDS = {"prefix", "zh_name", "en_name", "suffix"}


# ──────────────────────────────────────────────────────────────────────────────
# 专辑名称推断
# ──────────────────────────────────────────────────────────────────────────────

def infer_album_names(folder_name: str) -> tuple[str, str, str, str]:
    """智能推断专辑前缀、中文名、英文名和后缀
    
    优先使用LLM解析，失败则回退：直接将文件夹名作为中文名
    
    返回 (prefix, zh_name, en_name, suffix) 元组
    """
    # 尝试LLM解析
    if LLM_CLIENT:
        result = LLM_CLIENT.parse_album_name(folder_name)
        if result:
            prefix = result.get("prefix", "")
            zh_name = result.get("zh_name", "")
            en_name = result.get("en_name", "")
            suffix = result.get("suffix", "")
            
            # 如果中文名和英文名完全相同，说明是纯英文名，清空中文名
            if zh_name and en_name and zh_name == en_name:
                zh_name = ""
            
            return prefix, zh_name, en_name, suffix
    
    # LLM不可用时，直接将文件夹名作为中文名
    text = folder_name.strip()
    if not text:
        return "", "", "", ""
    return "", text, "", ""


# ──────────────────────────────────────────────────────────────────────────────
# TOML 格式化写入
# ──────────────────────────────────────────────────────────────────────────────

def _fmt_str(value: str) -> str:
    """将字符串值格式化为 TOML 字符串字面量（保留内嵌引号，使用双引号包裹）。"""
    # 若值本身含双引号，转义；若含换行，也转义
    return json.dumps(value, ensure_ascii=False)


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
            lines.append(f"{_fmt_str(toml_key)} = {_fmt_list(lst)}")
        else:
            s = str(value) if value else ""
            lines.append(f"{_fmt_str(toml_key)} = {_fmt_str(s)}")
    return "\n".join(lines) + "\n"


# ──────────────────────────────────────────────────────────────────────────────
# 合并逻辑
# ──────────────────────────────────────────────────────────────────────────────

def merge(existing: dict[str, Any], lrc: dict[str, Any], names: dict[str, str], force_names: bool = False) -> dict[str, Any]:
    """
    合并现有 meta.toml 数据、LRC 提取结果和推断的名称。

    规则：
    - 列表字段：meta.toml 非空则保留；空则使用 LRC 结果（可能仍为空）
    - 名称字段：meta.toml 非空则保留（除非 force_names）；空则使用推断结果
    - 字符串字段：始终保留 meta.toml 的值（LRC 无法提供）
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
            if internal in _NAME_FIELDS:
                # 名称字段特殊处理
                ex_val = existing.get(internal) or ""
                if ex_val and not force_names:
                    merged[internal] = ex_val  # meta.toml 有值且不强制→保留
                else:
                    merged[internal] = names.get(internal) or ""  # 用推断值
            else:
                # 其他字符串字段
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
    force_names: bool = False,
) -> bool:
    """
    处理单张专辑。返回 True 表示 meta.toml 实际被写入（发生变化）。
    """
    album_name = album_dir.name
    lrc_files = sorted(album_dir.glob("*.lrc"))
    existing_meta, meta_path = load_album_meta(album_dir)

    # 从 LRC 提取
    lrc_meta = merge_album_lrc_metadata(lrc_files)
    
    # 推断专辑名称（仅在必要时调用）
    # 如果现有meta中已有任意名称字段且不是force_names模式，则跳过LLM调用
    has_any_name = any(existing_meta.get(field) for field in _NAME_FIELDS)
    need_infer = force_names or not has_any_name
    
    if need_infer:
        inferred_prefix, inferred_zh, inferred_en, inferred_suffix = infer_album_names(album_name)
        names = {
            "prefix": inferred_prefix,
            "zh_name": inferred_zh,
            "en_name": inferred_en,
            "suffix": inferred_suffix
        }
    else:
        # 使用现有值
        names = {
            "prefix": existing_meta.get("prefix", ""),
            "zh_name": existing_meta.get("zh_name", ""),
            "en_name": existing_meta.get("en_name", ""),
            "suffix": existing_meta.get("suffix", "")
        }

    # 合并
    merged = merge(existing_meta, lrc_meta, names, force_names)

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
        with _PRINT_LOCK:
            print(f"  {status} {album_name}")
        
        # 显示名称字段
        for field in ["prefix", "zh_name", "en_name", "suffix"]:
            val = merged.get(field) or ""
            ex_val = existing_meta.get(field) or ""
            inf_val = names.get(field) or ""
            
            if not val:
                source = " [空]"
            elif ex_val and not force_names:
                source = " [保留]"
            elif inf_val:
                source = " [推断]" if LLM_CLIENT else " [文件夹名]"
            else:
                source = ""
            
            display_name = {"prefix": "前缀", "zh_name": "中文名", "en_name": "英文名", "suffix": "后缀"}[field]
            if val or verbose:
                with _PRINT_LOCK:
                    print(f"    {display_name:<6} = {val or '(空)'}{source}")
        
        # 显示其他字段
        for internal, toml_key, typ in FIELD_SCHEMA:
            if internal in _NAME_FIELDS:
                continue
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
            with _PRINT_LOCK:
                print(f"    {toml_key:<6} = {display}{source}")

    if changed and not dry_run:
        target.write_text(new_content, encoding="utf-8")

    return changed


# ──────────────────────────────────────────────────────────────────────────────
# 主入口
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="从 LRC 文件提取元数据、推断专辑名称并写入完整 meta.toml"
    )
    parser.add_argument("--album", metavar="NAME", help="仅处理指定专辑文件夹名")
    parser.add_argument("--dry-run", action="store_true", help="预览但不实际写入")
    parser.add_argument("--force-names", action="store_true", help="强制重新推断名称，覆盖现有值")
    parser.add_argument("--verbose", action="store_true", help="输出每个字段的来源和值")
    parser.add_argument("--workers", type=int, default=4, metavar="N", help="并发处理的线程数（默认4）")
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
    print(f"{mode}开始处理 {len(album_dirs)} 张专辑（{args.workers} 线程并发）...\n")

    changed_count = 0
    
    # 使用线程池并发处理
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        # 提交所有任务
        future_to_album = {
            executor.submit(
                process_album,
                album_dir,
                dry_run=args.dry_run,
                verbose=args.verbose,
                force_names=args.force_names
            ): album_dir
            for album_dir in album_dirs
        }
        
        # 收集结果
        for future in as_completed(future_to_album):
            album_dir = future_to_album[future]
            try:
                changed = future.result()
                if changed:
                    changed_count += 1
                    if not args.verbose:
                        marker = "[preview]" if args.dry_run else "[updated]"
                        with _PRINT_LOCK:
                            print(f"  {marker} {album_dir.name}")
                elif not args.verbose:
                    with _PRINT_LOCK:
                        print(f"  [=]       {album_dir.name}")
            except Exception as e:
                with _PRINT_LOCK:
                    print(f"  [ERROR]   {album_dir.name}: {e}", file=sys.stderr)

    print(f"\n完成。共 {len(album_dirs)} 张专辑，{changed_count} 张 meta.toml 已{'预览' if args.dry_run else '更新'}。")


if __name__ == "__main__":
    main()
