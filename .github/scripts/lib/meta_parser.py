from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .config_loader import load_config


_CONFIG = load_config()
_META_CONFIG = _CONFIG.get("meta", {})

DEFAULT_META: dict[str, Any] = dict(_META_CONFIG.get("defaults", {}))
_DECODE_ORDER = tuple(_META_CONFIG.get("decode_order", ["utf-8-sig", "utf-8", "gb18030", "gbk"]))
_MAPPING: dict[str, str] = dict(_META_CONFIG.get("mapping", {}))


def _decode_bytes(raw: bytes) -> str:
    for encoding in _DECODE_ORDER:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _unescape_toml_string(s: str) -> str:
    """解析 TOML 字符串中的转义序列。
    
    支持标准 TOML 转义：\\, \", \n, \t, \r, \b, \f
    """
    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            next_char = s[i + 1]
            if next_char == '\\':
                result.append('\\')
                i += 2
            elif next_char == '"':
                result.append('"')
                i += 2
            elif next_char == "'":
                result.append("'")
                i += 2
            elif next_char == 'n':
                result.append('\n')
                i += 2
            elif next_char == 't':
                result.append('\t')
                i += 2
            elif next_char == 'r':
                result.append('\r')
                i += 2
            elif next_char == 'b':
                result.append('\b')
                i += 2
            elif next_char == 'f':
                result.append('\f')
                i += 2
            else:
                # 未识别的转义序列，保留原样
                result.append(s[i])
                i += 1
        else:
            result.append(s[i])
            i += 1
    return ''.join(result)


def _parse_scalar(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and ((text[0] == '"' and text[-1] == '"') or (text[0] == "'" and text[-1] == "'")):
        inner = text[1:-1]
        # 对双引号字符串处理转义序列
        if text[0] == '"':
            return _unescape_toml_string(inner)
        # 单引号字符串不处理转义（TOML规范）
        return inner
    return text


def _parse_array(value: str) -> list[str]:
    text = value.strip()
    if not (text.startswith("[") and text.endswith("]")):
        return []

    body = text[1:-1].strip()
    if not body:
        return []

    items = []
    current = []
    in_quote = False
    quote_char = ""

    for char in body:
        if char in {'"', "'"}:
            if not in_quote:
                in_quote = True
                quote_char = char
            elif quote_char == char:
                in_quote = False
            current.append(char)
            continue

        if char == "," and not in_quote:
            token = "".join(current).strip()
            if token:
                items.append(_parse_scalar(token))
            current = []
            continue

        current.append(char)

    token = "".join(current).strip()
    if token:
        items.append(_parse_scalar(token))

    return [item for item in items if item and item != "N/A"]


def parse_meta_text(content: str) -> dict[str, Any]:
    meta = dict(DEFAULT_META)
    mapping = _MAPPING

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        match = re.match(r"^([^=]+?)\s*=\s*(.+)$", line)
        if not match:
            continue

        key = match.group(1).strip()
        value = match.group(2).strip()
        canonical = mapping.get(key)
        if not canonical:
            continue

        if canonical in {"produce", "lyric_maker", "vocal", "lyricist", "composer", "arranger", "tuning", "illustrator", "mixer"}:
            meta[canonical] = _parse_array(value)
        else:
            parsed = _parse_scalar(value)
            if parsed != "N/A":
                meta[canonical] = parsed

    return meta


def load_album_meta(album_path: Path) -> tuple[dict[str, Any], Path | None]:
    meta_path = album_path / "meta.toml"
    info_path = album_path / "info.toml"

    target: Path | None = None
    if meta_path.exists():
        target = meta_path
    elif info_path.exists():
        target = info_path

    if target is None:
        return dict(DEFAULT_META), None

    content = _decode_bytes(target.read_bytes())
    return parse_meta_text(content), target
