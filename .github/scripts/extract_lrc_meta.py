"""extract_lrc_meta.py — 从 res/ 目录下所有 LRC 文件提取元数据

用法
----
# 扫描全部专辑，输出缺失字段报告（默认）
python .github/scripts/extract_lrc_meta.py

# 仅看某张专辑
python .github/scripts/extract_lrc_meta.py --album "丛林法则Jungle Rules"

# 以 JSON 格式输出
python .github/scripts/extract_lrc_meta.py --format json

# 输出每首歌的提取结果（详细模式）
python .github/scripts/extract_lrc_meta.py --verbose

# 将建议 diff 写入文件
python .github/scripts/extract_lrc_meta.py --diff-out suggestions.txt
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

# 在 Windows 上强制使用 UTF-8 输出，避免 GBK 编码错误
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 允许直接运行（无需设置 PYTHONPATH）
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from lib.lrc_meta_extractor import extract_lrc_metadata, merge_album_lrc_metadata
from lib.config_loader import load_config
from lib.meta_parser import load_album_meta

CONFIG = load_config()
META_CONFIG = CONFIG.get("meta", {})
PROJECT = CONFIG.get("project", {})

ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))

_FIELD_TO_META_KEY: dict[str, str] = {
    str(item.get("internal")): str(item.get("toml_key"))
    for item in META_CONFIG.get("field_schema", [])
    if item.get("type") == "list"
}

_META_CANONICAL: dict[str, str] = {key: key for key in _FIELD_TO_META_KEY}


def fmt_list(lst: list[str]) -> str:
    if not lst:
        return "(空)"
    return "、".join(lst)


def _suggest_toml_additions(
    album_dir: Path,
    lrc_merged: dict,
    existing_meta: dict,
) -> list[str]:
    """
    比对 LRC 提取结果与现有 meta.toml，返回建议补充的行（TOML 格式）。
    只建议 meta.toml 中**缺失或为空**的字段。
    """
    suggestions: list[str] = []
    for lrc_field, meta_key_cn in _FIELD_TO_META_KEY.items():
        lrc_vals: list[str] = lrc_merged.get(lrc_field) or []
        if not lrc_vals:
            continue
        # 查看 meta.toml 中是否已有对应字段
        existing_vals = existing_meta.get(_META_CANONICAL.get(lrc_field, "")) or []
        if isinstance(existing_vals, list) and existing_vals:
            continue  # 已有值，跳过

        quoted = ", ".join(f'"{v}"' for v in lrc_vals)
        suggestions.append(f'{meta_key_cn} = [{quoted}]')

    return suggestions


def process_album(
    album_dir: Path,
    verbose: bool = False,
    fmt: str = "text",
) -> dict:
    """处理单张专辑，返回结构化结果。"""
    lrc_files = sorted(album_dir.glob("*.lrc"))
    existing_meta, meta_path = load_album_meta(album_dir)

    songs: list[dict] = []
    for lrc in lrc_files:
        song_meta = extract_lrc_metadata(lrc)
        songs.append({"file": lrc.name, "meta": song_meta})

    merged = merge_album_lrc_metadata(lrc_files)
    suggestions = _suggest_toml_additions(album_dir, merged, existing_meta)

    return {
        "album": album_dir.name,
        "meta_path": str(meta_path) if meta_path else None,
        "lrc_count": len(lrc_files),
        "merged": merged,
        "suggestions": suggestions,
        "songs": songs if verbose else [],
    }


def print_text_report(results: list[dict], diff_lines: list[str]) -> None:
    """以可读文本格式输出报告。"""
    for r in results:
        print(f"\n{'=' * 60}")
        print(f"[专辑] {r['album']}  ({r['lrc_count']} 首)")
        if r["meta_path"]:
            print(f"   meta.toml：{r['meta_path']}")
        else:
            print("   [!] 未找到 meta.toml")
        print()

        merged = r["merged"]
        fields_order = [
            ("vocal", "演唱"),
            ("composer", "作曲"),
            ("arranger", "编曲"),
            ("lyricist", "作词"),
            ("tuning", "调校"),
            ("illustrator", "曲绘"),
            ("mixer", "混音"),
        ]
        any_found = False
        for field, label in fields_order:
            vals = merged.get(field) or []
            if vals:
                print(f"   {label:<4} {fmt_list(vals)}")
                any_found = True
        if merged.get("album_tag"):
            print(f"   专辑    {merged['album_tag']}")
            any_found = True
        if not any_found:
            print("   (未从 LRC 提取到任何字段)")

        # 详细模式：每首歌
        for song in r.get("songs", []):
            m = song["meta"]
            print(f"\n   +-- {song['file']}")
            if m.get("title"):
                print(f"   |   [ti] {m['title']}")
            if m.get("song_title"):
                print(f"   |   song: {m['song_title']}")
            for field, label in fields_order:
                vals = m.get(field) or []
                if vals:
                    print(f"   |   {label:<4} {fmt_list(vals)}")
            print("   +--")

        if r["suggestions"]:
            print()
            print("   [建议] 补充到 meta.toml：")
            for line in r["suggestions"]:
                print(f"      {line}")
            diff_lines.extend([f"# {r['album']}", *r["suggestions"], ""])

    print(f"\n{'=' * 60}")
    print(f"共处理 {len(results)} 张专辑。")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="从 LRC 文件中提取元数据并与 meta.toml 对比，输出建议。"
    )
    parser.add_argument("--album", metavar="ALBUM_NAME", help="仅处理指定专辑文件夹名称")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="输出格式 (默认: text)")
    parser.add_argument("--verbose", action="store_true", help="逐曲详细输出")
    parser.add_argument("--diff-out", metavar="FILE", help="将建议写入文件（TOML 片段）")
    args = parser.parse_args()

    if not RES_DIR.exists():
        print(f"[ERROR] 找不到资源目录：{RES_DIR}", file=sys.stderr)
        sys.exit(1)

    if args.album:
        album_dirs = [RES_DIR / args.album]
        missing = [d for d in album_dirs if not d.is_dir()]
        if missing:
            print(f"[ERROR] 专辑目录不存在：{missing[0]}", file=sys.stderr)
            sys.exit(1)
    else:
        album_dirs = sorted([d for d in RES_DIR.iterdir() if d.is_dir()])

    results: list[dict] = []
    for album_dir in album_dirs:
        results.append(process_album(album_dir, verbose=args.verbose, fmt=args.format))

    if args.format == "json":
        # JSON 输出时剔除不可序列化的字段
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    diff_lines: list[str] = []
    print_text_report(results, diff_lines)

    if args.diff_out and diff_lines:
        out_path = Path(args.diff_out)
        out_path.write_text("\n".join(diff_lines), encoding="utf-8")
        print(f"\n[OK] 建议已写入：{out_path}")


if __name__ == "__main__":
    main()
