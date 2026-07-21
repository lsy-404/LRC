#!/usr/bin/env python3
"""ingest/ocr.py — 用视觉模型把歌词图片识别成文字。

用法：
    python -m ingest.ocr <image1> [image2 ...] [--out result.txt]
    python -m ingest.ocr --dir <投递目录>            # 识别目录内所有图片

设计：
- 每张图单独请求，专注「逐行转录歌词，不翻译不润色不补全」。
- 失败的图记入 stderr，不中断其余图片。
- 输出：把每张图结果按 `# === <文件名> ===` 分段拼接（或 --json 输出结构化）。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from ingest import _llm  # type: ignore
else:
    from . import _llm

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff"}

OCR_SYSTEM = """你是歌词本图片转录专家。图片通常是专辑歌词本，**既含歌词、也含歌曲源信息**
（如作词/作曲/编曲/演唱/调校/混音/曲绘等 staff，以及专辑名、发行日期、出品、发布/购买链接）。
请把图片中的全部文字逐行、原样转录出来。

严格规则：
1. 只转录图片里真实出现的文字，不翻译、不润色、不补全、不臆测
2. **歌词与 staff/制作/发行等源信息都要转录，不要丢弃 credits**
3. 保留原有换行与分行；若版面能明显区分「歌词区」与「制作信息区」，可在各区前加一行标记
   `[LYRICS]` 或 `[CREDITS]`（仅当你有把握时，不确定就直接顺序转录）
4. 忽略纯装饰性符号/水印/页码
5. 若图片中没有任何文字，只输出一行：[NO_TEXT]
6. 不要输出任何解释或额外说明，只输出转录正文"""


def find_images(directory: Path) -> list[Path]:
    return sorted(
        p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def ocr_image(path: Path) -> str:
    """对单张图片做 OCR，返回转录文本（失败抛 _llm.LLMError）。"""
    data_url = _llm.encode_image_data_url(path)
    messages = [
        {"role": "system", "content": OCR_SYSTEM},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "请转录这张图片中的歌词文字。"},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        },
    ]
    text = _llm.chat_auto(messages, kind="vision")
    return "" if text.strip() == "[NO_TEXT]" else text.strip()


def run(images: list[Path]) -> dict[str, str]:
    """返回 {文件名: 转录文本}，跳过失败项。"""
    out: dict[str, str] = {}
    for img in images:
        try:
            text = ocr_image(img)
        except _llm.LLMError as e:
            print(f"⚠️  OCR 失败 {img.name}: {e}", file=sys.stderr, flush=True)
            continue
        if text:
            out[img.name] = text
            print(f"✓ OCR {img.name} ({len(text)} 字)", file=sys.stderr, flush=True)
        else:
            print(f"○ OCR {img.name}: 无文字", file=sys.stderr, flush=True)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="歌词图片 OCR（视觉模型）")
    ap.add_argument("images", nargs="*", help="图片文件路径")
    ap.add_argument("--dir", help="识别该目录下所有图片")
    ap.add_argument("--out", help="写入文本文件（默认 stdout）")
    ap.add_argument("--json", action="store_true", help="输出结构化 JSON")
    args = ap.parse_args(argv)

    images: list[Path] = [Path(p) for p in args.images]
    if args.dir:
        images += find_images(Path(args.dir))
    images = [p for p in images if p.is_file()]
    if not images:
        print("没有可识别的图片", file=sys.stderr)
        return 0

    result = run(images)

    if args.json:
        text_out = json.dumps(result, ensure_ascii=False, indent=2)
    else:
        text_out = "\n\n".join(
            f"# === {name} ===\n{txt}" for name, txt in result.items()
        )

    if args.out:
        Path(args.out).write_text(text_out + "\n", encoding="utf-8")
        print(f"✓ 写入 {args.out}", file=sys.stderr)
    else:
        print(text_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
