import os
import re
import sys
from urllib.parse import urlparse


def split_changed_files(raw: str) -> list[str]:
    if not raw:
        return []
    return [item for item in re.split(r"\s+", raw.strip()) if item]


def is_meaningful_text(content: str) -> bool:
    allowed_pattern = re.compile(r"[\u4e00-\u9fff\u0020-\u007f\s\[\]\(\)\:\.\,\-'\"\?！，。：]")
    if not content:
        return False
    matches = allowed_pattern.findall(content)
    return (len(matches) / len(content)) > 0.8


URL_PATTERN = re.compile(
    r'(?:(?:https?://)|(?:www\.))[^\s<>"]+|(?:\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/[^\s<>"]*)'
)

ALLOWED_HOST_SUFFIXES = [
    "bilibili.com",
    "b23.tv",
    "taobao.com",
    "tb.cn",
    "m.tb.cn",
    "e.tb.cn",
    "dizzylab.com",
]


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
    files = split_changed_files(os.getenv("CHANGED_FILES", ""))
    deleted = split_changed_files(os.getenv("DELETED_FILES", ""))

    error_msgs: list[str] = []

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
            if file_size > 20 * 1024:
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

        elif ext in [".jpg", ".png", ".jpeg", ".webp"]:
            if name_part != "cover":
                error_msgs.append(f"❌ 图片必须命名为 cover (如 cover.jpg): {file}")
            if file_size > 5 * 1024 * 1024:
                error_msgs.append(f"❌ 封面图片过大 (>5MB): {file}")

        elif ext == ".toml":
            if filename != "meta.toml":
                error_msgs.append(f"❌ TOML文件必须命名为 meta.toml: {file}")
            if file_size > 5 * 1024:
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
        if folder_counts[dirname] > 20:
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
