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
import re
import sys
import uuid
from dataclasses import dataclass
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

# 这些是已在实际转写中出现的非歌词水印，必须以完整短语匹配；不能因单词
# "zither" 或 "harp" 存在就删除，后者可以是正常英文歌词的一部分。
_WATERMARK_KEY = re.compile(r"[^a-z0-9一-鿿]+")
_CONFIRMED_WATERMARKS = {
    "字幕由amaraorg社区提供",
    "字幕由amaraorg社群提供",
    "字幕由amaraorg字幕组提供",
    "由amaraorg社区提供的字幕",
    "由amaraorg社群提供的字幕",
    "由amaraorg字幕组提供的字幕",
    "优优独播剧场",
    "yoyotelevisionseriesexclusive",
    "优优独播剧场yoyotelevisionseriesexclusive",
    "词曲李宗盛",
    "演唱李宗盛",
    "编曲李宗盛",
    "作词李宗盛",
    "作曲李宗盛",
}
_MAX_WATERMARK_TOKEN_SPAN = max(map(len, _CONFIRMED_WATERMARKS))
_LI_ZONGSHENG_ATTRIBUTION = re.compile(r"(?:词曲|演唱|编曲|作词|作曲)\s*[:：]?\s*李宗盛")

# 仅在四项信号全部出现时移除未声明文本。Whisper 对歌曲副歌常给出重复段落，
# 所以重复本身、低置信本身或静音概率本身都不能作为删除依据。
_AUTO_NO_SPEECH_MIN = 0.80
_AUTO_AVG_LOGPROB_MAX = -1.00
_AUTO_COMPRESSION_RATIO_MIN = 2.40


@dataclass
class Transcription:
    """兼容原有 ``words, lang = transcribe_words(...)`` 的转写结果。"""

    words: list[dict]
    lang: str
    cleanup: dict

    def __iter__(self):
        yield self.words
        yield self.lang


def _watermark_key(text: object) -> str:
    return _WATERMARK_KEY.sub("", str(text or "").casefold())


def _strip_li_zongsheng_attribution(text: object) -> str:
    return _LI_ZONGSHENG_ATTRIBUTION.sub("", str(text or "")).strip()


def _watermark_span(words: list[dict], index: int) -> int:
    """返回从 index 开始的已知水印词数；0 表示普通歌词。

    只消除完整 Zither Harp 标记、其无空格变体和明确的 Amara 字幕归属句。
    连续出现的同一水印会逐段匹配清除，但普通重复歌词保持原样。
    """
    key = _watermark_key(words[index].get("text"))
    if key == "zitherharp":
        return 1
    if key == "zither" and index + 1 < len(words) and _watermark_key(words[index + 1].get("text")) == "harp":
        return 2
    joined = ""
    for size in range(1, min(_MAX_WATERMARK_TOKEN_SPAN, len(words) - index) + 1):
        joined += _watermark_key(words[index + size - 1].get("text"))
        if joined in _CONFIRMED_WATERMARKS:
            return size
    return 0


def _remove_word_indexes(words: list[dict], indexes: set[int]) -> list[dict]:
    """移除词并把被移除段末边界转交给前一个保留词。"""
    kept: list[dict] = []
    for i, word in enumerate(words):
        if i in indexes:
            if word.get("seg_end") and kept:
                kept[-1]["seg_end"] = True
            continue
        kept.append(dict(word))
    return kept


def filter_watermark_words(words: list[dict]) -> list[dict]:
    """剔除确认的 STT 水印，同时保留其余词和可用的 segment 边界。"""
    remove: set[int] = set()
    i = 0
    while i < len(words):
        span = _watermark_span(words, i)
        text = "" if span else _strip_li_zongsheng_attribution(words[i].get("text"))
        if span:
            remove.update(range(i, i + span))
        elif not text:
            remove.add(i)
        elif text != words[i].get("text"):
            words[i] = {**words[i], "text": text}
        i += span or 1
    return _remove_word_indexes(words, remove)


def _segment_key(words: list[dict], segment: int) -> str:
    return "".join(_watermark_key(w.get("text")) for w in words if w.get("_segment") == segment)


def filter_highly_suspicious_words(words: list[dict], segments: list[dict]) -> tuple[list[dict], dict]:
    """保守地移除 Whisper 静音幻觉，返回可写入 review bundle 的摘要。

    未声明文本必须是连续三段相同短句，且每段都同时满足高静音概率、低
    avg_logprob 和高 compression_ratio；任一指标缺失也保留。这样普通副歌和
    低置信但有声的歌词不会因单一启发式被删。
    """
    remove: set[int] = set()
    removed_segments: list[int] = []
    keys = [_segment_key(words, n) for n in range(len(segments))]
    for start in range(max(0, len(segments) - 2)):
        run = keys[start:start + 3]
        if len(run) != 3 or not run[0] or len(set(run)) != 1:
            continue
        for segment_index in range(start, start + 3):
            segment = segments[segment_index]
            try:
                suspicious = (
                    float(segment["no_speech_prob"]) >= _AUTO_NO_SPEECH_MIN
                    and float(segment["avg_logprob"]) <= _AUTO_AVG_LOGPROB_MAX
                    and float(segment["compression_ratio"]) >= _AUTO_COMPRESSION_RATIO_MIN
                )
            except (KeyError, TypeError, ValueError):
                suspicious = False
            if not suspicious:
                break
        else:
            for segment_index in range(start, start + 3):
                removed_segments.append(segment_index)
                remove.update(i for i, word in enumerate(words) if word.get("_segment") == segment_index)

    if not remove:
        return words, {"removed_word_count": 0, "removed_segments": []}
    cleaned = _remove_word_indexes(words, remove)
    return cleaned, {
        "removed_word_count": len(remove),
        "removed_segments": sorted(set(removed_segments)),
        "reason": "highly_suspected_stt_pollution",
        "signals": ["three_consecutive_repeated_segments", "no_speech_prob>=0.80",
                    "avg_logprob<=-1.00", "compression_ratio>=2.40"],
    }


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
    """转码后上传：默认 192kbps 立体声（≤48kHz）；按时长自动降级码率。

    各档位由 API 25MB 上限的数学边界推出（MB/分钟 ≈ kbps×0.0075）：
      ≤16 分钟  192k 立体声（1.44MB/min，17.4 分钟触顶）
      ≤32 分钟  96k 单声道（0.72MB/min，34.7 分钟触顶）
      ≤64 分钟  48k 单声道（0.36MB/min，69 分钟触顶——覆盖 1 小时需求）
      更长      32k 单声道（0.24MB/min，约 104 分钟触顶）
    百 MB 级 wav/flac 源文件不再受上限约束。ffmpeg/ffprobe 失败直接抛错。
    """
    import os
    import subprocess
    import tempfile
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(audio)],
        capture_output=True, text=True, check=True)
    minutes = float(probe.stdout.strip() or 0.0) / 60
    if minutes <= 16:
        enc, desc = ["-b:a", "192k"], "192k 立体声"
    elif minutes <= 32:
        enc, desc = ["-ac", "1", "-b:a", "96k"], "96k 单声道"
    elif minutes <= 64:
        enc, desc = ["-ac", "1", "-b:a", "48k"], "48k 单声道"
    else:
        enc, desc = ["-ac", "1", "-b:a", "32k"], "32k 单声道"
    if minutes > 16:
        print(f"  ▽ {audio.name} 时长 {minutes:.1f} 分钟，自动降级 {desc}",
              file=sys.stderr, flush=True)
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


def _parse_verbose_json_with_cleanup(result: dict, lang: str | None) -> tuple[list[dict], str, dict]:
    """verbose_json → ([{start,end,text,seg_end?}], 语言代码)。纯函数便于测试。"""
    words = [{"start": float(w["start"]), "end": float(w["end"]),
              "text": str(w.get("word", "")).strip()}
             for w in (result.get("words") or []) if str(w.get("word", "")).strip()]
    # 用 segment 边界给词标 seg_end（organize._words_to_lines 的断行依据）
    segments = result.get("segments") or []
    for segment_index, s in enumerate(segments):
        s_start = float(s.get("start", 0.0))
        s_end = float(s.get("end", 0.0))
        best = None
        for w in words:
            if w["end"] <= s_end + 0.05 and w["start"] >= s_start - 0.05:
                w["_segment"] = segment_index
                best = w
            elif w["start"] > s_end + 0.05:
                break
        if best is not None:
            best["seg_end"] = True
    words = filter_watermark_words(words)
    words, cleanup = filter_highly_suspicious_words(words, segments)
    words = [{k: v for k, v in word.items() if k != "_segment"} for word in words]
    lang_name = str(result.get("language", "")).strip().lower()
    code = lang or _LANG_CODE.get(lang_name, lang_name[:2])
    return words, code, cleanup


def _parse_verbose_json(result: dict, lang: str | None) -> tuple[list[dict], str]:
    """verbose_json 的兼容入口；详情由转写流程写入 review bundle。"""
    words, code, _ = _parse_verbose_json_with_cleanup(result, lang)
    return words, code


def transcribe_words(audio: Path, pipeline=None, lang: str | None = None) -> Transcription:
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
    words, code, cleanup = _parse_verbose_json_with_cleanup(result, lang)
    dur = result.get("duration")
    print(f"✓ STT(云端词级) {audio.name}: {len(words)} 词, 语言={code}, 时长={dur}s",
          file=sys.stderr, flush=True)
    return Transcription(words, code, cleanup)


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
