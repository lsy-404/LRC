#!/usr/bin/env python3
"""ingest/proofread.py — 歌词草稿文字校对（LLM）。

把 OCR / 投稿者手打的歌词草稿做轻度校对：
- 修正明显的错别字、OCR 误识（如 形近字、漏字）
- 规整分行、去掉多余空白与装饰符
- **不改写歌词内容、不翻译、不补全缺失段落**

用法：
    python -m ingest.proofread <draft.txt> [--out clean.txt]
    echo "草稿" | python -m ingest.proofread -
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from ingest import _llm  # type: ignore
else:
    from . import _llm

PROOFREAD_SYSTEM = """你是中文歌词校对员。请对给定的歌词草稿做**保守**校对。

只允许做：
1. 修正明显错别字、形近字、OCR 误识（如「己/已」「未/末」「日/曰」）
2. 去掉多余空格、重复空行、明显的装饰符号/水印残留
3. 规整分行，使每句歌词独占一行

严禁：
- 翻译、改写、润色歌词用词
- 补全你认为「缺失」的句子或段落
- 调整歌词原意、增删实义字
- 添加任何解释、标题、注释

只输出校对后的歌词正文，不要输出任何额外文字。若输入为空，输出空。"""


def proofread(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    messages = [
        {"role": "system", "content": PROOFREAD_SYSTEM},
        {"role": "user", "content": text},
    ]
    result = _llm.chat(messages, model=_llm.text_model())
    return result.strip()


def proofread_safe(text: str) -> str:
    """失败时回退原文（校对是增强项，不应丢内容）。"""
    try:
        return proofread(text)
    except _llm.LLMError as e:
        print(f"⚠️  校对失败，保留原文: {e}", file=sys.stderr, flush=True)
        return (text or "").strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="歌词草稿校对（LLM）")
    ap.add_argument("input", help="草稿文件路径，或 - 表示读 stdin")
    ap.add_argument("--out", help="写入文件（默认 stdout）")
    args = ap.parse_args(argv)

    if args.input == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(args.input).read_text(encoding="utf-8", errors="replace")

    result = proofread_safe(raw)

    if args.out:
        Path(args.out).write_text(result + "\n", encoding="utf-8")
        print(f"✓ 写入 {args.out}", file=sys.stderr)
    else:
        print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
