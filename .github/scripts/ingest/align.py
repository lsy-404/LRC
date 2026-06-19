#!/usr/bin/env python3
"""ingest/align.py — 把准确歌词强制对齐到 STT 字级时间轴，生成高质量 LRC。

设计（R3 核心升华）：
- STT（faster-whisper, word_timestamps）只提供**时间轴**，其识别的字可能不准。
- 准确歌词来自歌词本（txt/pdf/照片 OCR）。
- 用序列对齐把「准确歌词字流」对到「STT 字流（带时间）」上，
  让每行准确歌词拿到 STT 对应位置的时间戳 → 行级 LRC（可选字级增强 LRC）。

对齐用标准库 difflib.SequenceMatcher（字符级 LCS），无第三方依赖。
中文模式下可选用 pypinyin 把汉字转拼音再做 LCS，消除同音错字漏对齐。
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

try:
    from pypinyin import lazy_pinyin, Style as _PinyinStyle  # type: ignore
    _PYPINYIN_OK = True
except ImportError:
    _PYPINYIN_OK = False


def _py_key(ch: str) -> str:
    """CJK 汉字 → 无调拼音字符串（如 '风'→'feng'）；非 CJK 原样小写返回。
    用作 SequenceMatcher 比较键，消除同音错字漏对齐。
    """
    if _PYPINYIN_OK and ("一" <= ch <= "鿿" or "㐀" <= ch <= "䶿"):
        py = lazy_pinyin(ch, style=_PinyinStyle.NORMAL)
        return py[0] if py else ch.lower()
    return ch.lower()


def _cmp_seqs(char_list: list[str], use_pinyin: bool) -> list[str]:
    """把字符列表转为比较序列（可以是拼音 token 列表，也可以原字）。"""
    if use_pinyin:
        return [_py_key(c) for c in char_list]
    return list(char_list)


@dataclass
class SttChar:
    ch: str       # 归一化后的单字
    t: float      # 该字的时间戳（秒）


def _is_keepable(ch: str) -> bool:
    """对齐时保留的字符：CJK 表意文字 + 字母 + 数字。标点/空格忽略。"""
    if ch.isalnum():
        return True
    cat = unicodedata.category(ch)
    return cat.startswith("L") or cat.startswith("N")


def _norm(ch: str) -> str:
    return ch.lower()


def stt_words_to_chars(words: list[dict]) -> list[SttChar]:
    """把 STT 词级时间戳展开为字级时间轴（词内按时长线性插值）。"""
    chars: list[SttChar] = []
    for w in words:
        text = (w.get("text") or "").strip()
        start = float(w.get("start", 0.0) or 0.0)
        end = float(w.get("end", start) or start)
        kept = [c for c in text if _is_keepable(c)]
        if not kept:
            continue
        span = max(end - start, 0.0)
        n = len(kept)
        for i, c in enumerate(kept):
            t = start + (span * i / n if n > 1 else 0.0)
            chars.append(SttChar(_norm(c), t))
    return chars


@dataclass
class RefChar:
    line_idx: int
    is_line_start: bool


def ref_lines_to_chars(lines: list[str]) -> tuple[str, list[RefChar]]:
    """把准确歌词行展开为归一化字流 + 每字的(行号,是否行首)元数据。"""
    norm_chars: list[str] = []
    meta: list[RefChar] = []
    for li, line in enumerate(lines):
        first = True
        for c in line:
            if not _is_keepable(c):
                continue
            norm_chars.append(_norm(c))
            meta.append(RefChar(li, first))
            first = False
    return "".join(norm_chars), meta


def _has_kana(s: str) -> bool:
    """Return True if the string contains Japanese hiragana or katakana."""
    return any("぀" <= c <= "ゟ" or "゠" <= c <= "ヿ" for c in s)


def _detect_bilingual_pairs(lines: list[str]) -> dict[int, int]:
    """Detect alternating bilingual lines (e.g. Japanese original + Chinese translation).

    Returns {translation_line_idx: original_line_idx}.
    Activates only when ≥3 pairs and ≥60% of consecutive non-empty pairs alternate kana/no-kana
    in a consistent order (kana always first, or always second).
    """
    nonempty = [(i, ln) for i, ln in enumerate(lines) if ln.strip()]
    if len(nonempty) < 4:
        return {}

    total_possible = len(nonempty) // 2
    pair_count = 0
    kana_first_count = 0
    for k in range(0, len(nonempty) - 1, 2):
        h1 = _has_kana(nonempty[k][1])
        h2 = _has_kana(nonempty[k + 1][1])
        if h1 != h2:
            pair_count += 1
            if h1:
                kana_first_count += 1

    if pair_count < 3 or pair_count < total_possible * 0.6:
        return {}

    ratio = kana_first_count / pair_count
    kana_first = ratio >= 0.7
    kana_second = ratio <= 0.3
    if not kana_first and not kana_second:
        return {}  # inconsistent order — not a clean bilingual song

    result: dict[int, int] = {}
    for k in range(0, len(nonempty) - 1, 2):
        i1, l1 = nonempty[k]
        i2, l2 = nonempty[k + 1]
        if _has_kana(l1) != _has_kana(l2):
            if _has_kana(l1):
                result[i2] = i1  # i2 is translation of Japanese i1
            else:
                result[i1] = i2  # i1 is translation of Japanese i2
    return result


def _fmt_ts(seconds: float, ms_digits: int = 2) -> str:
    if seconds < 0:
        seconds = 0.0
    m = int(seconds // 60)
    s = seconds - m * 60
    if ms_digits == 3:
        return f"{m:02d}:{s:06.3f}"
    return f"{m:02d}:{s:05.2f}"


def align(
    reference_lines: list[str],
    words: list[dict],
    *,
    title: str = "",
    album: str = "",
    by: str = "",
    per_char: bool = False,
    language: str = "",
) -> str:
    """返回对齐后的 LRC 文本。

    reference_lines 应为纯歌词行（不含 staff 头）。
    words 为 [{start,end,text}, ...]（faster-whisper 词级）。
    language: STT 检测的语言代码（如 'zh'/'ja'/'en'）；
              zh 时若 pypinyin 可用则用拼音 LCS，其余语言用字符级 LCS。
    """
    use_pinyin = _PYPINYIN_OK and (language or "").startswith("zh")
    lines = [ln.rstrip() for ln in reference_lines]
    ref_str, ref_meta = ref_lines_to_chars(lines)
    stt_chars = stt_words_to_chars(words)
    stt_str = "".join(c.ch for c in stt_chars)

    # 每个 ref 字的时间（None=未对齐上）
    ref_time: list[Optional[float]] = [None] * len(ref_meta)
    if ref_str and stt_str:
        ref_cmp = _cmp_seqs(list(ref_str), use_pinyin)
        stt_cmp = _cmp_seqs(list(stt_str), use_pinyin)
        sm = SequenceMatcher(None, ref_cmp, stt_cmp, autojunk=False)
        for i, j, n in sm.get_matching_blocks():
            for k in range(n):
                ref_time[i + k] = stt_chars[j + k].t

    # 收集每行已对齐字的(行内偏移, 时间)，并统计每行可对齐字数
    n_lines = len(lines)
    line_start: list[Optional[float]] = [None] * n_lines
    line_char_times: dict[int, list[tuple[int, float]]] = {}  # 行 → [(行内偏移, t)]
    line_local_idx: dict[int, int] = {}
    for idx, meta in enumerate(ref_meta):
        li = meta.line_idx
        local = line_local_idx.get(li, 0)
        line_local_idx[li] = local + 1
        t = ref_time[idx]
        if t is not None:
            line_char_times.setdefault(li, []).append((local, t))

    # 全曲演唱字速率（秒/字）：各行已对齐首尾字速率的中位数，钳制在合理区间
    rates = []
    for pairs in line_char_times.values():
        (o1, t1), (o2, t2) = pairs[0], pairs[-1]
        if o2 > o1 and t2 > t1:
            rates.append((t2 - t1) / (o2 - o1))
    rate = sorted(rates)[len(rates) // 2] if rates else 0.35
    rate = min(max(rate, 0.15), 0.8)

    # 行首时间：行首字若未对齐（STT 漏识别行首会让行首偏晚），从首个对齐字按字速率回推，
    # 但不早于上一行最后一个对齐字之后一个字位
    prev_anchor = 0.0
    for li in range(n_lines):
        pairs = line_char_times.get(li)
        if not pairs:
            continue
        o0, t0 = pairs[0]
        line_start[li] = max(t0 - o0 * rate, prev_anchor + rate) if o0 > 0 else t0
        prev_anchor = pairs[-1][1]

    # 整行未对齐：按各行字数加权插值/外推
    # （固定 0.5s/行远小于真实行时长，会把开头未识别的行挤到很晚）
    chars = [line_local_idx.get(li, 0) for li in range(n_lines)]
    known = [li for li, t in enumerate(line_start) if t is not None]
    if known:
        for li in range(n_lines):
            if line_start[li] is not None:
                continue
            prev = max((k for k in known if k < li), default=None)
            nxt = min((k for k in known if k > li), default=None)
            if prev is not None and nxt is not None:
                span_chars = sum(chars[l] for l in range(prev, nxt)) or (nxt - prev)
                done_chars = sum(chars[l] for l in range(prev, li)) or (li - prev)
                line_start[li] = line_start[prev] + (line_start[nxt] - line_start[prev]) * done_chars / span_chars
            elif prev is not None:
                line_start[li] = line_start[prev] + sum(chars[l] for l in range(prev, li)) * rate
            elif nxt is not None:
                line_start[li] = max(0.0, line_start[nxt] - sum(chars[l] for l in range(li, nxt)) * rate)
    # 单调化
    last = 0.0
    for li in range(n_lines):
        if line_start[li] is None:
            line_start[li] = last
        line_start[li] = max(line_start[li], last)
        last = line_start[li]

    # 双语：翻译行继承原文行时间戳（两行共享同一 [ts]，LRC 播放器同时显示双语）
    translation_pairs = _detect_bilingual_pairs(lines)
    for trans_idx, orig_idx in translation_pairs.items():
        if orig_idx < n_lines and trans_idx < n_lines:
            line_start[trans_idx] = line_start[orig_idx]

    # 输出
    out: list[str] = []
    if title:
        out.append(f"[ti:{title}]")
    if album:
        out.append(f"[al:{album}]")
    out.append(f"[ar:]")
    out.append(f"[by:{by}]")
    out.append("")
    for li, line in enumerate(lines):
        if not line.strip():
            continue
        ts = _fmt_ts(line_start[li] or 0.0)
        if per_char and li in line_char_times:
            # 增强 LRC：行首时间 + 行内每字 <时间>
            times = dict(line_char_times[li])
            buf = f"[{ts}]"
            local = 0
            for c in line:
                if _is_keepable(c) and local in times:
                    buf += f"<{_fmt_ts(times[local])}>{c}"
                    local += 1
                elif _is_keepable(c):
                    buf += c
                    local += 1
                else:
                    buf += c
            out.append(buf)
        else:
            out.append(f"[{ts}]{line.strip()}")
    return "\n".join(out) + "\n"


def coverage(reference_lines: list[str], words: list[dict], language: str = "") -> float:
    """对齐覆盖率（匹配上的 ref 字 / 总 ref 字），用于评估/选择最佳歌词匹配。

    双语歌词中，翻译行（无 kana）不计入覆盖率，避免虚低导致音频匹配失误。
    language: 同 align()；zh 时用拼音 LCS 提高准确率。
    """
    use_pinyin = _PYPINYIN_OK and (language or "").startswith("zh")
    translation_pairs = _detect_bilingual_pairs(reference_lines)
    orig_lines = [l for i, l in enumerate(reference_lines) if i not in translation_pairs]
    ref_str, _ = ref_lines_to_chars(orig_lines if orig_lines else reference_lines)
    stt_str = "".join(c.ch for c in stt_words_to_chars(words))
    if not ref_str or not stt_str:
        return 0.0
    ref_cmp = _cmp_seqs(list(ref_str), use_pinyin)
    stt_cmp = _cmp_seqs(list(stt_str), use_pinyin)
    sm = SequenceMatcher(None, ref_cmp, stt_cmp, autojunk=False)
    matched = sum(n for _, _, n in sm.get_matching_blocks())
    return matched / len(ref_str)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="准确歌词 × STT 时间轴 → LRC")
    ap.add_argument("--lyrics", required=True, help="准确歌词文本文件（每行一句，不含 staff 头）")
    ap.add_argument("--words", required=True, help="STT 词级时间戳 JSON（[{start,end,text}]）")
    ap.add_argument("--title", default="")
    ap.add_argument("--album", default="")
    ap.add_argument("--by", default="")
    ap.add_argument("--per-char", action="store_true", help="输出字级增强 LRC")
    ap.add_argument("--language", default="", help="STT 语言代码（如 zh/ja/en）；zh 时启用拼音 LCS")
    ap.add_argument("--out", help="输出文件（默认 stdout）")
    args = ap.parse_args(argv)

    lines = Path(args.lyrics).read_text(encoding="utf-8", errors="replace").splitlines()
    words = json.loads(Path(args.words).read_text(encoding="utf-8"))
    lrc = align(lines, words, title=args.title, album=args.album, by=args.by,
                per_char=args.per_char, language=args.language)
    cov = coverage(lines, words, language=args.language)
    print(f"对齐覆盖率: {cov:.1%}", file=sys.stderr)
    if args.out:
        Path(args.out).write_text(lrc, encoding="utf-8")
        print(f"✓ 写入 {args.out}", file=sys.stderr)
    else:
        print(lrc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
