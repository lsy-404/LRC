#!/usr/bin/env python3
"""ingest/stt.py — 音频 → 歌词文本（本地 WhisperX）。

把投递的歌曲源文件（wav/mp3/flac/m4a/...）转写为带时间轴的歌词草稿。
注意：歌曲（带伴奏/演唱）STT 准确率有限，产物一律标注「机器转写，待人工校对」。

底层链路：
    pyannote VAD → faster-whisper (CTranslate2 内核) → wav2vec2 强制对齐
WhisperX 把这三块封成一个 pipeline；强制对齐显著提升词级时间戳精度，
正是 align.py 强制对齐到歌词本时最需要的输入。

用法：
    python -m ingest.stt <audio> [--out song.lrc] [--lang zh] [--model small]
    python -m ingest.stt --dir <投递目录>

环境变量：
    WHISPER_MODEL    模型大小，默认 small（tiny/base/small/medium/large-v3 / large-v3-turbo）
    WHISPER_DEVICE   cpu（默认）/cuda
    WHISPER_LANG     强制语言，默认自动检测
    WHISPER_VAD      pyannote（默认；需 HF_TOKEN）/ silero（公开权重无需 token）
    WHISPER_BATCH    批大小，默认 8
    HF_TOKEN         pyannote VAD 必需（gated 模型）；silero 可不设

依赖：whisperx / pyannote.audio / faster-whisper（见 ingest/requirements.txt）。
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


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _load_pipeline():
    """惰性加载 WhisperX ASR + VAD；align 模型按检测出的语言再单独加载。

    返回 (asr_model, device_str, hf_token_or_none, model_size_str)。
    """
    try:
        import whisperx  # type: ignore  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "未安装 whisperx，请先 `pip install -r .github/scripts/ingest/requirements.txt`"
        ) from e
    import whisperx
    model_size = os.environ.get("WHISPER_MODEL", "small")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = "int8" if device == "cpu" else "float16"
    vad_method = os.environ.get("WHISPER_VAD", "pyannote").lower()
    hf_token = os.environ.get("HF_TOKEN")
    if vad_method == "pyannote" and not hf_token:
        raise RuntimeError(
            "WHISPER_VAD=pyannote 需要 HF_TOKEN（pyannote/segmentation-3.0 是 gated 模型）。"
            "设置 HF_TOKEN 环境变量，或改用 WHISPER_VAD=silero。"
        )
    load_kwargs: dict = {
        "device": device,
        "compute_type": compute_type,
        "vad_method": vad_method,
    }
    asr = whisperx.load_model(model_size, **load_kwargs)
    return asr, device, hf_token, model_size


def _transcribe_segments(asr, audio_arr, lang: str | None) -> tuple[list[dict], str]:
    """跑 ASR（句级）→ 返回 (segments, detected_language)。"""
    transcribe_kwargs: dict = {"batch_size": _env_int("WHISPER_BATCH", 8)}
    forced_lang = lang or os.environ.get("WHISPER_LANG") or None
    if forced_lang:
        transcribe_kwargs["language"] = forced_lang
    result = asr.transcribe(audio_arr, **transcribe_kwargs)
    return result.get("segments") or [], result.get("language") or (forced_lang or "?")


def _align_words(segments: list[dict], audio_arr, device: str, language: str) -> list[dict]:
    """跑 wav2vec2 强制对齐 → 返回带词级 words 的 segments。

    若该语言无 wav2vec2 模型则原样返回（segments 仍可能含 Whisper 自带 words）。
    """
    import whisperx
    try:
        align_model, meta = whisperx.load_align_model(language_code=language, device=device)
    except Exception as e:  # noqa: BLE001 — 不支持该语种就回退
        print(
            f"⚠️ 该语言({language})无 wav2vec2 强制对齐模型，回退到 Whisper 自带词级时间戳：{e}",
            file=sys.stderr, flush=True,
        )
        return segments
    aligned = whisperx.align(
        segments, align_model, meta, audio_arr, device,
        return_char_alignments=False,
    )
    return aligned.get("segments") or []


def transcribe_words(audio: Path, pipeline=None, lang: str | None = None) -> tuple[list[dict], str]:
    """转写单个音频，返回**字级/词级时间戳**列表 + 检测语言。

    返回 ([{start,end,text}, ...], language)。供 ingest.align 强制对齐用——
    STT 只取时间轴，歌词文本以歌词本为准。
    """
    import whisperx
    if pipeline is None:
        pipeline = _load_pipeline()
    asr, device, _hf, _model = pipeline
    audio_arr = whisperx.load_audio(str(audio))
    segments, language = _transcribe_segments(asr, audio_arr, lang)
    aligned_segs = _align_words(segments, audio_arr, device, language)

    words: list[dict] = []
    for seg in aligned_segs:
        seg_words: list[dict] = []
        for w in seg.get("words") or []:
            text = (w.get("word") or w.get("text") or "").strip()
            if not text:
                continue
            start = w.get("start")
            if start is None:
                continue
            end = w.get("end")
            seg_words.append({
                "start": float(start),
                "end": float(end if end is not None else start),
                "text": text,
            })
        if seg_words:
            seg_words[-1]["seg_end"] = True  # segment 边界：供 _words_to_tracks 分行用
        words.extend(seg_words)
    print(
        f"✓ STT(词级) {audio.name}: {len(words)} 词, 语言={language}",
        file=sys.stderr, flush=True,
    )
    return words, language


def transcribe(audio: Path, pipeline=None, lang: str | None = None) -> str:
    """转写单个音频，返回 LRC 文本（含 [ti]/[by] 头与时间轴）。

    句级（segment）时间轴，由 WhisperX ASR 给出；
    更精细的词级时间轴见 transcribe_words。
    """
    import whisperx
    if pipeline is None:
        pipeline = _load_pipeline()
    asr, _device, _hf, model_size = pipeline
    audio_arr = whisperx.load_audio(str(audio))
    segments, language = _transcribe_segments(asr, audio_arr, lang)

    lines = [
        f"[ti:{audio.stem}]",
        "[ar:]",
        f"[by:{MACHINE_NOTE}]",
        f"[re:whisperx {model_size} ({os.environ.get('WHISPER_VAD', 'pyannote')} VAD)]",
        "",
    ]
    n = 0
    for seg in segments:
        text = (seg.get("text") or "").strip()
        start = seg.get("start")
        if not text or start is None:
            continue
        lines.append(f"[{_fmt_ts(float(start))}]{text}")
        n += 1
    print(f"✓ STT {audio.name}: {n} 行, 语言={language}", file=sys.stderr, flush=True)
    return "\n".join(lines) + "\n"


def run(audios: list[Path], out_dir: Path | None, lang: str | None) -> dict[str, str]:
    """批量转写，返回 {音频名: lrc文本}；写文件到 out_dir（若给）。"""
    if not audios:
        return {}
    pipeline = _load_pipeline()
    results: dict[str, str] = {}
    for audio in audios:
        try:
            lrc = transcribe(audio, pipeline=pipeline, lang=lang)
        except Exception as e:  # noqa: BLE001 — 单文件失败不应中断其余
            print(f"⚠️  STT 失败 {audio.name}: {e}", file=sys.stderr, flush=True)
            continue
        results[audio.name] = lrc
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{audio.stem}.lrc").write_text(lrc, encoding="utf-8")
    return results


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="音频转歌词（WhisperX）")
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
        pipeline = _load_pipeline()
        lrc = transcribe(audios[0], pipeline=pipeline, lang=args.lang)
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
