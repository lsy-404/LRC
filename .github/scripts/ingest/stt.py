#!/usr/bin/env python3
"""ingest/stt.py — 音频 → 歌词文本（本地 faster-whisper）。

把投递的歌曲源文件（wav/mp3/flac/m4a/...）转写为带时间轴的歌词草稿。
注意：歌曲（带伴奏/演唱）STT 准确率有限，产物一律标注「机器转写，待人工校对」。

用法：
    python -m ingest.stt <audio> [--out song.lrc] [--lang zh] [--model small]
    python -m ingest.stt --dir <投递目录>

环境变量：
    WHISPER_MODEL    模型大小，默认 small（tiny/base/small/medium/large-v3）
    WHISPER_DEVICE   cpu（默认）/cuda
    WHISPER_LANG     强制语言，默认自动检测

依赖：faster-whisper（见 ingest/requirements.txt）。未安装时给出清晰报错。
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"}

MACHINE_NOTE = "机器转写，待人工校对"


def _fmt_ts(seconds: float) -> str:
    """秒 → [mm:ss.xxx] LRC 时间戳。"""
    if seconds < 0:
        seconds = 0.0
    minutes = int(seconds // 60)
    rem = seconds - minutes * 60
    return f"{minutes:02d}:{rem:06.3f}"


def find_audio(directory: Path) -> list[Path]:
    return sorted(
        p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTS
    )


def _load_model():
    """惰性加载 faster-whisper，缺依赖时报清晰错误。"""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "未安装 faster-whisper，请先 `pip install -r .github/scripts/ingest/requirements.txt`"
        ) from e
    model_size = os.environ.get("WHISPER_MODEL", "small")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = "int8" if device == "cpu" else "float16"
    return WhisperModel(model_size, device=device, compute_type=compute_type)


def transcribe_words(audio: Path, model=None, lang: str | None = None) -> tuple[list[dict], str]:
    """转写单个音频，返回**字级/词级时间戳**列表 + 检测语言。

    返回 ([{start,end,text}, ...], language)。供 ingest.align 强制对齐用——
    STT 只取时间轴，歌词文本以歌词本为准。
    """
    if model is None:
        model = _load_model()
    language = lang or os.environ.get("WHISPER_LANG") or None
    # 关键：vad_filter=True 会把"演唱人声"当非语音切掉（实测召回 81→437 词，
    # 覆盖整首）；condition_on_previous_text=False 减少歌词重复/幻觉传播。
    segments, info = model.transcribe(
        str(audio),
        language=language,
        vad_filter=False,
        condition_on_previous_text=False,
        beam_size=5,
        word_timestamps=True,
    )
    words: list[dict] = []
    for seg in segments:
        for w in (getattr(seg, "words", None) or []):
            text = (w.word or "").strip()
            if not text:
                continue
            words.append({"start": float(w.start), "end": float(w.end), "text": text})
    detected = getattr(info, "language", language or "?")
    print(f"✓ STT(词级) {audio.name}: {len(words)} 词, 语言={detected}", file=sys.stderr, flush=True)
    return words, detected


def transcribe(audio: Path, model=None, lang: str | None = None) -> str:
    """转写单个音频，返回 LRC 文本（含 [ti]/[by] 头与时间轴）。"""
    if model is None:
        model = _load_model()
    language = lang or os.environ.get("WHISPER_LANG") or None
    segments, info = model.transcribe(
        str(audio),
        language=language,
        vad_filter=False,
        condition_on_previous_text=False,
        beam_size=5,
    )
    lines = [
        f"[ti:{audio.stem}]",
        "[ar:]",
        f"[by:{MACHINE_NOTE}]",
        f"[re:faster-whisper {os.environ.get('WHISPER_MODEL', 'small')}]",
        "",
    ]
    n = 0
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        lines.append(f"[{_fmt_ts(seg.start)}]{text}")
        n += 1
    detected = getattr(info, "language", language or "?")
    print(f"✓ STT {audio.name}: {n} 行, 语言={detected}", file=sys.stderr, flush=True)
    return "\n".join(lines) + "\n"


def run(audios: list[Path], out_dir: Path | None, lang: str | None) -> dict[str, str]:
    """批量转写，返回 {音频名: lrc文本}；写文件到 out_dir（若给）。"""
    if not audios:
        return {}
    model = _load_model()
    results: dict[str, str] = {}
    for audio in audios:
        try:
            lrc = transcribe(audio, model=model, lang=lang)
        except Exception as e:  # noqa: BLE001 — 单文件失败不应中断其余
            print(f"⚠️  STT 失败 {audio.name}: {e}", file=sys.stderr, flush=True)
            continue
        results[audio.name] = lrc
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{audio.stem}.lrc").write_text(lrc, encoding="utf-8")
    return results


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="音频转歌词（faster-whisper）")
    ap.add_argument("audios", nargs="*", help="音频文件路径")
    ap.add_argument("--dir", help="转写该目录下所有音频")
    ap.add_argument("--out", help="单文件输出路径（仅单个音频时有效）")
    ap.add_argument("--out-dir", help="批量输出目录")
    ap.add_argument("--lang", help="强制语言（如 zh / en / ja）")
    args = ap.parse_args(argv)

    audios: list[Path] = [Path(p) for p in args.audios]
    if args.dir:
        audios += find_audio(Path(args.dir))
    audios = [p for p in audios if p.is_file()]
    if not audios:
        print("没有可转写的音频", file=sys.stderr)
        return 0

    if args.out and len(audios) == 1:
        model = _load_model()
        lrc = transcribe(audios[0], model=model, lang=args.lang)
        Path(args.out).write_text(lrc, encoding="utf-8")
        print(f"✓ 写入 {args.out}", file=sys.stderr)
        return 0

    out_dir = Path(args.out_dir) if args.out_dir else None
    results = run(audios, out_dir, args.lang)
    if not out_dir:
        for name, lrc in results.items():
            print(f"# === {name} ===\n{lrc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
