import json
import os
import re
import sys
import tomllib
import subprocess
from urllib.parse import urlparse

from lib.config_loader import load_config

CONFIG = load_config()
PULL_CONFIG = CONFIG.get("pull", {})
COMMON_CONFIG = CONFIG.get("common", {})


def _clean_changed_item(item: str) -> str:
    cleaned = (item or "").strip()
    if len(cleaned) >= 2 and cleaned[0] == '"' and cleaned[-1] == '"':
        cleaned = cleaned[1:-1]
    cleaned = _decode_octal_escapes(cleaned)
    return cleaned


def _decode_octal_escapes(raw: str) -> str:
    if not raw or "\\" not in raw:
        return raw
    if not re.search(r"\\[0-7]{3}", raw):
        return raw
    buffer = bytearray()
    index = 0
    length = len(raw)
    while index < length:
        char = raw[index]
        if char == "\\" and index + 3 < length:
            octal = raw[index + 1 : index + 4]
            if re.fullmatch(r"[0-7]{3}", octal):
                buffer.append(int(octal, 8))
                index += 4
                continue
        buffer.extend(char.encode("utf-8"))
        index += 1
    try:
        return buffer.decode("utf-8")
    except UnicodeDecodeError:
        return raw


def _try_load_json(raw: str):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def split_changed_files(raw: str) -> list[str]:
    if not raw:
        return []
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == '"' and raw[-1] == '"':
        unwrapped = _try_load_json(raw)
        if unwrapped is not None:
            raw = unwrapped
    if isinstance(raw, str):
        raw = raw.strip()
        if raw == "[]":
            return []
    if raw.startswith("[") and raw.endswith("]"):
        parsed = _try_load_json(raw)
        if parsed is None:
            decoded = _decode_octal_escapes(raw)
            if decoded != raw:
                parsed = _try_load_json(decoded)
        if parsed is None:
            normalized = raw.replace('""', '"')
            parsed = _try_load_json(normalized)
        if parsed is None:
            normalized = raw.replace('""', '"')
            quoted = re.findall(r'"((?:\\.|[^"\\])*)"', normalized)
            if quoted:
                parsed = [item.replace(r'\\"', '"') for item in quoted if item.strip()]
        if isinstance(parsed, str):
            parsed = _try_load_json(parsed)
        if isinstance(parsed, list):
            return [_clean_changed_item(str(item)) for item in parsed if str(item).strip()]
    if "\n" in raw:
        return [_clean_changed_item(line) for line in raw.splitlines() if line.strip()]
    quoted = re.findall(r'"((?:\\.|[^"\\])*)"', raw)
    if quoted:
        return [_clean_changed_item(item.replace(r'\\"', '"')) for item in quoted if item.strip()]
    return [_clean_changed_item(item) for item in re.split(r"\s+", raw) if item]


def load_changed_files_from_inputs(env_key: str, file_env_key: str) -> list[str]:
    toml_path = (os.getenv(f"{env_key}_TOML", "") or "").strip()
    if toml_path:
        try:
            with open(toml_path, "rb") as f:
                payload = tomllib.load(f)
            entries = payload.get("files")
            if isinstance(entries, list):
                return [_clean_changed_item(str(item)) for item in entries if str(item).strip()]
        except OSError:
            pass
        except tomllib.TOMLDecodeError:
            try:
                with open(toml_path, "r", encoding="utf-8-sig") as f:
                    payload = tomllib.loads(f.read())
                entries = payload.get("files")
                if isinstance(entries, list):
                    return [_clean_changed_item(str(item)) for item in entries if str(item).strip()]
            except (OSError, tomllib.TOMLDecodeError):
                pass

    file_path = (os.getenv(file_env_key, "") or "").strip()
    if file_path:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return split_changed_files(f.read())
        except OSError:
            pass
    return split_changed_files(os.getenv(env_key, ""))


def _run_git(args: list[str]) -> str:
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def _run_git_bytes(args: list[str]) -> bytes:
    result = subprocess.run(args, capture_output=True, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(stderr or "git command failed")
    return result.stdout


def _get_head_sha() -> str:
    return _run_git(["git", "rev-parse", "HEAD"]).strip()


def _split_null_paths(raw: bytes) -> list[str]:
    parts = [item for item in raw.split(b"\x00") if item]
    decoded: list[str] = []
    for item in parts:
        text = item.decode("utf-8", errors="replace").strip()
        if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
            text = text[1:-1]
        decoded.append(text)
    return decoded


def _get_git_changed_files(base_sha: str, head_sha: str) -> tuple[list[str], list[str]]:
    changed_raw = _run_git_bytes([
        "git",
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=ACMR",
        base_sha,
        head_sha,
    ])
    deleted_raw = _run_git_bytes([
        "git",
        "-c",
        "core.quotepath=false",
        "diff",
        "--name-only",
        "-z",
        "--diff-filter=D",
        base_sha,
        head_sha,
    ])
    changed = _split_null_paths(changed_raw)
    deleted = _split_null_paths(deleted_raw)
    return changed, deleted


def is_meaningful_text(content: str) -> bool:
    allowed_pattern = re.compile(r"[\u4e00-\u9fff\u0020-\u007f\s\[\]\(\)\:\.\,\-'\"\?！，。：]")
    if not content:
        return False
    matches = allowed_pattern.findall(content)
    return (len(matches) / len(content)) > 0.8


URL_PATTERN = re.compile(
    r'(?:(?:https?://)|(?:www\.))[^\s<>"]+|(?:\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/[^\s<>"]*)'
)

ALLOWED_HOST_SUFFIXES = [str(item) for item in PULL_CONFIG.get("whitelist_url", []) if item]


def normalize_host(raw_url: str) -> str:
    candidate = raw_url.strip().rstrip(".,;:!?)]}")
    if not candidate:
        return ""
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return ""
    host = (parsed.netloc or "").lower()
    if "@" in host:
        host = host.split("@", 1)[-1]
    if ":" in host:
        host = host.split(":", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    return host


def is_allowed_host(host: str) -> bool:
    if not host:
        return False
    for suffix in ALLOWED_HOST_SUFFIXES:
        if host == suffix or host.endswith("." + suffix):
            return True
    return False


def find_disallowed_urls(text: str) -> list[str]:
    invalid: list[str] = []
    for match in URL_PATTERN.finditer(text or ""):
        raw_url = match.group(0)
        host = normalize_host(raw_url)
        if host and not is_allowed_host(host):
            invalid.append(raw_url)
    return invalid


def main() -> int:
    base_sha = (os.getenv("BASE_SHA", "") or "").strip()
    head_sha = (os.getenv("HEAD_SHA", "") or "").strip()

    if base_sha and head_sha:
        head_before = _get_head_sha()
        if head_before != head_sha:
            print(f"❌ 本地 HEAD 与期望不一致: {head_before} != {head_sha}")
            return 1
        try:
            files, deleted = _get_git_changed_files(base_sha, head_sha)
        except RuntimeError as exc:
            print(f"❌ 获取改动列表失败: {exc}")
            return 1
        head_after = _get_head_sha()
        if head_after != head_before:
            print(f"❌ 审计期间 HEAD 发生变化: {head_before} -> {head_after}")
            return 1
    else:
        files = load_changed_files_from_inputs("CHANGED_FILES", "CHANGED_FILES_FILE")
        deleted = load_changed_files_from_inputs("DELETED_FILES", "DELETED_FILES_FILE")

    error_msgs: list[str] = []

    lrc_max_size = int(PULL_CONFIG.get("lrc_max_kb", 20)) * 1024
    meta_max_size = int(PULL_CONFIG.get("meta_max_kb", 5)) * 1024
    cover_max_size = int(PULL_CONFIG.get("cover_max_mb", 5)) * 1024 * 1024
    max_files_per_folder = int(PULL_CONFIG.get("max_files_per_folder", 20))
    cover_name = str(PULL_CONFIG.get("cover_name", "cover")).lower()
    meta_name = str(PULL_CONFIG.get("meta_name", "meta.toml")).lower()
    cover_ext = {str(item).lower() for item in COMMON_CONFIG.get("cover_ext", [".jpg", ".png", ".jpeg", ".webp", ".bmp"])}

    if deleted:
        error_msgs.append(f"❌ 禁止删除或重命名文件: {deleted}")

    folder_counts: dict[str, int] = {}

    for file in files:
        if not file.startswith("res/"):
            error_msgs.append(f"❌ 仅允许修改 res/ 目录下的文件: {file}")
            continue
        if "/." in file or os.path.islink(file):
            error_msgs.append(f"❌ 禁止隐藏文件或符号链接: {file}")
            continue

        filename = os.path.basename(file).lower()
        name_part, ext = os.path.splitext(filename)

        try:
            file_size = os.path.getsize(file)
        except OSError:
            continue

        if ext == ".lrc":
            if file_size > lrc_max_size:
                error_msgs.append(f"❌ LRC文件过大 (>20KB): {file}")
            try:
                with open(file, "r", encoding="utf-8") as f:
                    content = f.read()
                if not is_meaningful_text(content):
                    error_msgs.append(f"❌ LRC内容无效(疑似乱码或非歌词文本): {file}")
                disallowed_urls = find_disallowed_urls(content)
                if disallowed_urls:
                    preview = ", ".join(disallowed_urls[:3])
                    error_msgs.append(f"❌ LRC存在非白名单网址: {file} -> {preview}")
            except UnicodeDecodeError:
                error_msgs.append(f"❌ LRC必须使用 UTF-8 编码: {file}")

        elif ext in cover_ext:
            if name_part != cover_name:
                error_msgs.append(f"❌ 图片必须命名为 cover (如 cover.jpg): {file}")
            if file_size > cover_max_size:
                error_msgs.append(f"❌ 封面图片过大 (>5MB): {file}")

        elif ext == ".toml":
            if filename != meta_name:
                error_msgs.append(f"❌ TOML文件必须命名为 meta.toml: {file}")
            if file_size > meta_max_size:
                error_msgs.append(f"❌ meta.toml文件过大 (>5KB): {file}")
            try:
                with open(file, "r", encoding="utf-8") as f:
                    content = f.read()
                disallowed_urls = find_disallowed_urls(content)
                if disallowed_urls:
                    preview = ", ".join(disallowed_urls[:3])
                    error_msgs.append(f"❌ meta.toml存在非白名单网址: {file} -> {preview}")
            except UnicodeDecodeError:
                error_msgs.append(f"❌ meta.toml必须使用 UTF-8 编码: {file}")

        else:
            error_msgs.append(f"❌ 不支持的文件类型 ({ext}): {file}")

        dirname = os.path.dirname(file)
        folder_counts[dirname] = folder_counts.get(dirname, 0) + 1
        if folder_counts[dirname] > max_files_per_folder:
            error_msgs.append(f"❌ 文件夹 {dirname} 内文件超过20个限制")

    if error_msgs:
        with open("audit_errors.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(error_msgs))
        print("\n".join(error_msgs))
        return 1

    print("Audit Passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
