from __future__ import annotations

import re
import shutil
import urllib.parse
from pathlib import Path

from lib.config_loader import load_config
from lib.meta_parser import load_album_meta

CONFIG = load_config()
PROJECT = CONFIG.get("project", {})
COMMON = CONFIG.get("common", {})

REPO = str(PROJECT.get("repo", "wuyilingwei/LRC"))
ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / str(PROJECT.get("res_dir", "res"))
DOCS_DIR = ROOT_DIR / str(PROJECT.get("docs_dir", "docs"))
ALBUMS_DIR = ROOT_DIR / str(PROJECT.get("albums_dir", "docs/albums"))
COVER_EXTENSIONS = [str(item) for item in COMMON.get("cover_ext", [".jpg", ".png", ".jpeg", ".webp", ".bmp"])]


def _decode_lrc(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_lrc(file_path: Path) -> dict[str, str]:
    content = _decode_lrc(file_path.read_bytes())
    ti_match = re.search(r"\[ti:(.+?)\]", content)
    ar_match = re.search(r"\[ar:(.+?)\]", content)
    al_match = re.search(r"\[al:(.+?)\]", content)
    return {
        "title": ti_match.group(1) if ti_match else "",
        "artist": ar_match.group(1) if ar_match else "",
        "album": al_match.group(1) if al_match else "",
    }


def raw_meta_value(value: str) -> str:
    return (value or "").strip()


def is_disabled_value(value: str | list[str] | None) -> bool:
    """检查值是否为'不适用'或空值，返回True表示应该隐藏此字段"""
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0 or all(v.strip() == "不适用" for v in value)
    text = str(value).strip()
    return text == "" or text == "不适用" or text == "缺少信息"


def find_cover(album_path: Path) -> tuple[Path | None, str]:
    """查找cover文件，不区分大小写，返回统一小写的扩展名"""
    # 先尝试find_cover_files
    for file in album_path.iterdir():
        if file.is_file() and file.stem.lower() == "cover":
            # 返回原始文件和小写的扩展名
            ext_lower = file.suffix.lower()
            if ext_lower in COVER_EXTENSIONS:
                return file, ext_lower
    return None, ""


def ensure_dirs() -> None:
    ALBUMS_DIR.mkdir(parents=True, exist_ok=True)


def parse_sortable_date(value: str) -> tuple[int, int, int]:
    text = (value or "").strip()
    if not text or text == "缺少信息":
        return (0, 1, 1)

    match = re.fullmatch(r"(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?", text)
    if not match:
        return (0, 1, 1)

    year = int(match.group(1))
    month = int(match.group(2)) if match.group(2) else 1
    day = int(match.group(3)) if match.group(3) else 1

    if not (1 <= month <= 12 and 1 <= day <= 31):
        return (0, 1, 1)

    return (year, month, day)


def main() -> None:
    ensure_dirs()

    albums = sorted([path for path in RES_DIR.iterdir() if path.is_dir()], key=lambda p: p.name)

    album_cards: list[dict[str, str | int | list[str]]] = []

    for album_dir in albums:
        album = album_dir.name
        album_file_name = re.sub(r"\s+", "_", album)
        lrc_files = sorted([path for path in album_dir.iterdir() if path.suffix.lower() == ".lrc"])

        info, _ = load_album_meta(album_dir)

        songs = []
        for lrc_file in lrc_files:
            # 直接使用文件名（去掉 .lrc 后缀）作为歌曲标题
            song_title = lrc_file.stem
            songs.append({"title": song_title, "file": lrc_file.name})

        cover_file, cover_ext = find_cover(album_dir)
        if cover_file:
            dest_cover = ALBUMS_DIR / f"{album_file_name}{cover_ext}"
            shutil.copyfile(cover_file, dest_cover)

        # 检查cover文件是否存在（文件名已是小写）
        has_cover = False
        cover_display_ext = ""
        if cover_ext:
            target = ALBUMS_DIR / f"{album_file_name}{cover_ext}"
            if target.exists():
                has_cover = True
                cover_display_ext = cover_ext

        tags = [album]
        if not is_disabled_value(info["produce"]):
            tags.append(str(info["produce"]))
        # 不将歌词制作者加入tag，只显示在正文中
        for key in ("vocal", "lyricist", "composer", "tuning"):
            values = info.get(key) or []
            if isinstance(values, list) and not is_disabled_value(values):
                tags.extend([v for v in values if not is_disabled_value(v)])
        # 添加固定的搜索关键词
        tags.extend(["歌词", "lrc", "下载", "文件"])
        # 去重，保留首次出现顺序
        tags = list(dict.fromkeys(tags))

        info_display = []
        # 发行日期：跳过 1970-01-01 或空值
        year_value = str(info['year'] or "").strip()
        if year_value and year_value != "1970-01-01" and not is_disabled_value(year_value):
            info_display.append(f"**发行日期:** {year_value}")
        # 其他字段：使用 is_disabled_value 判断
        if not is_disabled_value(info["produce"]):
            info_display.append(f"**出品:** {info['produce']}")
        if not is_disabled_value(info.get("lyric_maker")):
            info_display.append(f"**歌词制作:** {info['lyric_maker']}")
        release_val = raw_meta_value(str(info.get("release") or ""))
        if release_val and not is_disabled_value(release_val):
            info_display.append(f"**发布:** {release_val}")
        purchase_val = raw_meta_value(str(info.get("purchase") or ""))
        if purchase_val and not is_disabled_value(purchase_val):
            info_display.append(f"**购买:** {purchase_val}")
        electronic_val = raw_meta_value(str(info.get("electronic") or ""))
        if electronic_val and not is_disabled_value(electronic_val):
            info_display.append(f"**电子:** {electronic_val}")
        if not is_disabled_value(info["vocal"]):
            info_display.append(f"**演唱:** {'、'.join(info['vocal'])}")
        if not is_disabled_value(info["lyricist"]):
            info_display.append(f"**作词:** {'、'.join(info['lyricist'])}")
        if not is_disabled_value(info["composer"]):
            info_display.append(f"**作曲:** {'、'.join(info['composer'])}")
        if not is_disabled_value(info.get("arranger")):
            info_display.append(f"**编曲:** {'、'.join(info['arranger'])}")
        if not is_disabled_value(info["tuning"]):
            info_display.append(f"**调校:** {'、'.join(info['tuning'])}")
        if not is_disabled_value(info.get("illustrator")):
            info_display.append(f"**曲绘:** {'、'.join(info['illustrator'])}")
        if not is_disabled_value(info.get("mixer")):
            info_display.append(f"**混音:** {'、'.join(info['mixer'])}")

        song_lines = "\n".join(
            f"- [{song['title']}](https://cdn.jsdelivr.net/gh/{REPO}@main/res/{urllib.parse.quote(album)}/{urllib.parse.quote(song['file'])})"
            for song in songs
        )

        date_tuple = parse_sortable_date(str(info.get("year") or ""))
        if date_tuple[0] != 0:
            order_val = -(date_tuple[0] * 10000 + date_tuple[1] * 100 + date_tuple[2])
        else:
            order_val = -1
        order_line = f"order: {order_val}\n"

        md_content = f"""---
title: {album}
{order_line}category:
  - {album}
tag:
{''.join(f'  - {tag}\n' for tag in tags)}---

# {album}

{f'<img src="./{album_file_name}{cover_display_ext}" alt="{album} 封面" class="album-cover" />' if has_cover else ''}

{((chr(10) + chr(10)).join(info_display) + chr(10)) if info_display else ''}
## 曲目列表

{song_lines}

## 下载

下载本专辑所有歌词文件：[ZIP 打包下载](https://cdn.jsdelivr.net/gh/{REPO}@main/pack/{urllib.parse.quote(album)}.zip)
"""

        (ALBUMS_DIR / f"{album_file_name}.md").write_text(md_content, encoding="utf-8")

        # 首页卡片图片路径：使用绝对路径（以 / 开头），VuePress会从网站根目录解析
        cover_url = f"/albums/{album_file_name}{cover_display_ext}" if has_cover else ""
        
        # 处理首页显示值：将空值、"缺少信息"视为"不适用"
        produce_display = str(info["produce"] or "")
        if is_disabled_value(produce_display):
            produce_display = "不适用"
        
        year_display = str(info["year"] or "")
        if is_disabled_value(year_display) or year_display == "1970-01-01":
            year_display = "不适用"
        
        album_cards.append(
            {
                "name": album,
                "file_name": album_file_name,
                "cover": cover_url,
                "produce": produce_display,
                "year": year_display,
                "tags": tags,
            }
        )

    album_cards.sort(key=lambda card: parse_sortable_date(str(card["year"])), reverse=True)

    cards_text = ["| | |", "|----|-----|"]
    for card in album_cards:
        year_line = f"发行日期：{card['year']}"
        zip_url = f"https://cdn.jsdelivr.net/gh/{REPO}@main/pack/{urllib.parse.quote(card['name'])}.zip"

        # 双列表格布局，左边图片，右边信息
        if card["cover"]:
            card_html = f"| <img src=\"{card['cover']}\" alt=\"{card['name']} 封面\" style=\"width: 100%; border-radius: 8px;\"> | <h3><a class=\"route-link\" href=\"/albums/{card['file_name']}.html\">{card['name']}</a></h3>出品：{card['produce']}<br>{year_line}<br><br>[ZIP 下载]({zip_url}) |"
        else:
            card_html = f"| | <h3><a class=\"route-link\" href=\"/albums/{card['file_name']}.html\">{card['name']}</a></h3>出品：{card['produce']}<br>{year_line}<br><br>[ZIP 下载]({zip_url}) |"
        cards_text.append(card_html)

    docs_readme = f"""---
icon: material-symbols:home
title: 首页
heroText: V宇宙词站
tagline: 虚拟歌姬专辑的导航与歌词共享资源库
---

## 关于本站

本站收录并整理虚拟歌姬专辑的信息及LRC歌词文件，方便爱好者购买专辑、查找专辑、在线浏览和下载使用。

所有歌词资源遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可协议并附加本站《商业使用补充条款》进行授权。

## 专辑列表

<div class="album-table">

{chr(10).join(cards_text)}

</div>

"""

    (DOCS_DIR / "README.md").write_text(docs_readme, encoding="utf-8")

    print("MD files generated successfully.")
    print(f"Generated {len(albums)} album pages and docs/README.md")


if __name__ == "__main__":
    main()
