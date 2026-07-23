#!/usr/bin/env python3
"""ingest/stt.py — 音频 → 词级时间戳（OpenAI 云端 whisper-1）。

本地 whisperx(small int8, CPU) 已换为云端 whisper-1（large-v2 级识别质量）：
- 词级时间戳：response_format=verbose_json + timestamp_granularities word+segment
- 多首可并发，STT 墙钟 13-15 分钟 → 约 2-3 分钟；不再需要 torch/HF 模型下载
- 计费按音频时长（$0.006/分钟）；上传前统一 ffmpeg 转码 16kHz 单声道 MP3，
  百 MB 级源文件压到 1-2MB，API 的 25MB 上限对任意大小源文件都不构成约束

用法：
    python -m ingest.stt <audio> [--lang zh]
    python -m ingest.stt --dir <投递目录>
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from urllib import request

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from ingest import _llm  # type: ignore
else:
    from . import _llm

AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"}

MACHINE_NOTE = "机器转写，待人工校对"

# verbose_json 返回语言全名 → ISO 代码（align/繁转简按代码判断）
_LANG_CODE = {"chinese": "zh", "mandarin": "zh", "japanese": "ja", "english": "en",
              "korean": "ko", "cantonese": "yue"}


def find_audio(directory: Path) -> list[Path]:
    return sorted(
        p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTS
    )


def _multipart(fields: dict, file_field: str, filename: str, data: bytes) -> tuple[bytes, str]:
    """构造 multipart/form-data 请求体（值为 list 的字段展开为重复键）。"""
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for k, v in fields.items():
        for val in (v if isinstance(v, list) else [v]):
            parts.append((f"--{boundary}\r\nContent-Disposition: form-data; "
                          f'name="{k}"\r\n\r\n{val}\r\n').encode("utf-8"))
    parts.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; "
                  f'filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'
                  ).encode("utf-8"))
    parts.append(data)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), boundary


def _compress_for_upload(audio: Path) -> tuple[bytes, str]:
    """转码后上传：默认 192kbps 立体声（≤48kHz）；超长音频自动回避压缩。

    192k 立体声约 1.4MB/分钟，约 17 分钟触及 API 25MB 上限——时长超过
    16 分钟的音频自动降为 96kbps 单声道（约 0.7MB/分钟，容纳约 34 分钟）。
    百 MB 级 wav/flac 源文件不再受上限约束。ffmpeg/ffprobe 失败直接抛错。
    """
    import os
    import subprocess
    import tempfile
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(audio)],
        capture_output=True, text=True, check=True)
    duration = float(probe.stdout.strip() or 0.0)
    if duration > 16 * 60:
        enc = ["-ac", "1", "-b:a", "96k"]
        print(f"  ▽ {audio.name} 时长 {duration/60:.1f} 分钟，回避压缩 96k 单声道",
              file=sys.stderr, flush=True)
    else:
        enc = ["-b:a", "192k"]
    fd, tmp = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    out = Path(tmp)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(audio), "-ar", "48000", *enc, str(out)],
            check=True)
        return out.read_bytes(), audio.stem + ".mp3"
    finally:
        out.unlink(missing_ok=True)


def _parse_verbose_json(result: dict, lang: str | None) -> tuple[list[dict], str]:
    """verbose_json → ([{start,end,text,seg_end?}], 语言代码)。纯函数便于测试。"""
    words = [{"start": float(w["start"]), "end": float(w["end"]),
              "text": str(w.get("word", "")).strip()}
             for w in (result.get("words") or []) if str(w.get("word", "")).strip()]
    # 用 segment 边界给词标 seg_end（organize._words_to_lines 的断行依据）
    for s in result.get("segments") or []:
        s_end = float(s.get("end", 0.0))
        best = None
        for w in words:
            if w["end"] <= s_end + 0.05:
                best = w
            else:
                break
        if best is not None:
            best["seg_end"] = True
    lang_name = str(result.get("language", "")).strip().lower()
    code = lang or _LANG_CODE.get(lang_name, lang_name[:2])
    return words, code


def transcribe_words(audio: Path, pipeline=None, lang: str | None = None) -> tuple[list[dict], str]:
    """转写单个音频，返回 ([{start,end,text}, ...], 语言代码)。失败抛 LLMError。

    pipeline 参数仅为兼容旧调用签名保留（云端无本地模型可加载）。
    """
    fields: dict = {
        "model": "whisper-1",
        "response_format": "verbose_json",
        "timestamp_granularities[]": ["word", "segment"],
    }
    if lang:
        fields["language"] = lang
    data, upload_name = _compress_for_upload(audio)
    body, boundary = _multipart(fields, "file", upload_name, data)
    req = request.Request(
        f"{_llm.OPENAI_API_BASE}/audio/transcriptions", data=body,
        headers={"Authorization": f"Bearer {_llm.api_key()}",
                 "Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST")
    try:
        with request.urlopen(req, timeout=600) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 — HTTPError 附 body 便于定位
        detail = ""
        if hasattr(e, "read"):
            try:
                detail = e.read().decode("utf-8")[:300]  # type: ignore[attr-defined]
            except Exception:
                pass
        raise _llm.LLMError(f"云端转写失败 {audio.name}: {e} {detail}")
    words, code = _parse_verbose_json(result, lang)
    dur = result.get("duration")
    print(f"✓ STT(云端词级) {audio.name}: {len(words)} 词, 语言={code}, 时长={dur}s",
          file=sys.stderr, flush=True)
    return words, code


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="音频词级转写（OpenAI whisper-1）")
    ap.add_argument("audios", nargs="*", help="音频文件路径")
    ap.add_argument("--dir", help="转写该目录下所有音频")
    ap.add_argument("--lang", help="强制语言代码（如 zh/ja）")
    args = ap.parse_args(argv)

    audios: list[Path] = [Path(p) for p in args.audios]
    if args.dir:
        audios += find_audio(Path(args.dir))
    audios = [p for p in audios if p.is_file()]
    if not audios:
        print("没有可转写的音频", file=sys.stderr)
        return 0
    for a in audios:
        words, code = transcribe_words(a, lang=args.lang)
        print(json.dumps({"file": a.name, "language": code, "words": words},
                         ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
