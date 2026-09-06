"""Uploaded LRC files are immutable authority sources.

The normal ingest path creates LRC from reference text and STT.  This module
does the opposite: it retains an uploaded LRC verbatim and, when possible,
creates a separate karaoke sidecar whose token times stay inside the uploaded
line boundaries.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from lib.lrc_lines import decode_lrc_bytes

if __package__ in (None, ""):
    from ingest import align as align_mod, lyrics as lyrics_mod  # type: ignore
else:
    from . import align as align_mod, lyrics as lyrics_mod


_TIME_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
_TITLE_RE = re.compile(r"^\[ti\s*:\s*(.*?)\s*\]$", re.IGNORECASE)
_KARAOKE_RE = re.compile(r"<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>")


def _seconds(match: re.Match[str]) -> float:
    fraction = match.group(3) or "0"
    return int(match.group(1)) * 60 + int(match.group(2)) + int(fraction) / (10 ** len(fraction))


def _timestamp(seconds: float) -> str:
    seconds = max(0.0, seconds)
    minutes = int(seconds // 60)
    return f"{minutes:02d}:{seconds - minutes * 60:06.3f}"


def _title(content: str, fallback: str) -> str:
    for line in content.splitlines():
        match = _TITLE_RE.match(line.strip())
        if match and match.group(1).strip():
            return match.group(1).strip()
    return fallback


def _timed_rows(content: str) -> list[tuple[float, str, str]]:
    """Return source-order (time, leading tags, body) rows without normalizing them."""
    rows: list[tuple[float, str, str]] = []
    for line in content.splitlines():
        matches = list(_TIME_RE.finditer(line))
        if not matches or matches[0].start() != 0:
            continue
        body = line[matches[-1].end():]
        for match in matches:
            rows.append((_seconds(match), line[:matches[-1].end()], body))
    return rows


def _plain_lrc(content: str) -> str:
    return _KARAOKE_RE.sub("", content)


def load_authoritative_track(path: Path, order: int, sidecar: Path | None = None) -> dict[str, Any]:
    """Load an uploaded LRC without altering a single lyric character."""
    content = decode_lrc_bytes(path.read_bytes())
    elrc = decode_lrc_bytes(sidecar.read_bytes()) if sidecar else (content if path.suffix.lower() == ".elrc" else None)
    lrc = _plain_lrc(content) if path.suffix.lower() == ".elrc" else content
    title = _title(lrc, path.stem)
    return {
        "order": order,
        "title": title,
        "lines": [body for _, _, body in _timed_rows(lrc) if body],
        "lrc": lrc,
        "klrc": elrc,
        "coverage": 0.0,
        "audio": "",
        "aligned": True,
        "edited": False,
        "timing_locked": True,
        "authoritative_lrc": True,
        "_source_stem": path.stem,
    }


def _comparison_key(char: str) -> str:
    """Use simplified text only for matching; the source text is never rewritten."""
    return lyrics_mod.to_simplified(char).lower()


def build_authoritative_klrc(content: str, words: list[dict]) -> tuple[str | None, float]:
    """Create an optional karaoke sidecar constrained by source LRC line bounds.

    The returned sidecar never feeds back into the authoritative `.lrc`.  Each
    inserted token tag is bounded by its source row's timestamp and the next
    source row timestamp.  Existing karaoke tags are retained as-is.
    """
    if not words:
        return None, 0.0
    rows = _timed_rows(content)
    if not rows or _KARAOKE_RE.search(content):
        return (content if _KARAOKE_RE.search(content) else None), 0.0

    char_rows: dict[int, list[tuple[int, float]]] = {}
    matched = total = 0
    for index, (start, _, body) in enumerate(rows):
        end = rows[index + 1][0] if index + 1 < len(rows) and rows[index + 1][0] > start else start + max(5.0, len(body) * 0.35)
        source_positions = [pos for pos, char in enumerate(body) if align_mod._is_keepable(char)]
        source_keys = [_comparison_key(body[pos]) for pos in source_positions]
        if not source_keys:
            continue
        stt_chars = [char for char in align_mod.stt_words_to_chars(words) if start <= char.t < end]
        matcher = SequenceMatcher(None, source_keys, [_comparison_key(char.ch) for char in stt_chars], autojunk=False)
        pairs: list[tuple[int, float]] = []
        for source_at, stt_at, count in matcher.get_matching_blocks():
            for offset in range(count):
                pairs.append((source_positions[source_at + offset], max(start, min(stt_chars[stt_at + offset].t, end))))
        if pairs:
            char_rows[index] = pairs
            matched += len(pairs)
        total += len(source_positions)

    if not char_rows:
        return None, 0.0

    rendered: list[str] = []
    row_index = 0
    for raw_line in content.splitlines():
        matches = list(_TIME_RE.finditer(raw_line))
        if not matches or matches[0].start() != 0:
            rendered.append(raw_line)
            continue
        body_start = matches[-1].end()
        body = raw_line[body_start:]
        pieces: list[str] = []
        for time, _, source_body in rows[row_index:row_index + len(matches)]:
            if source_body != body:
                break
            times = dict(char_rows.get(row_index, []))
            tagged = "".join((f"<{_timestamp(times[pos])}>" if pos in times else "") + char for pos, char in enumerate(body))
            pieces.append(f"[{_timestamp(time)}]{tagged}")
            row_index += 1
        if pieces:
            rendered.extend(pieces)
        else:
            rendered.append(raw_line)
            row_index += len(matches)
    suffix = "\n" if content.endswith("\n") else ""
    return "\n".join(rendered) + suffix, matched / total if total else 0.0
