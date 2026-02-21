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


def find_cover(album_path: Path) -> tuple[Path | None, str]:
    for ext in COVER_EXTENSIONS:
        cover = album_path / f"cover{ext}"
        if cover.exists():
            return cover, ext
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

        has_cover = False
        cover_display_ext = ""
        for ext in COVER_EXTENSIONS:
            target = ALBUMS_DIR / f"{album_file_name}{ext}"
            if target.exists():
                has_cover = True
                cover_display_ext = ext
                break

        tags = [album]
        if info["produce"]:
            tags.append(str(info["produce"]))
        # 不将歌词制作者加入tag，只显示在正文中
        for key in ("vocal", "lyricist", "composer", "tuning"):
            values = info.get(key) or []
            if isinstance(values, list):
                tags.extend(values)
        # 添加固定的搜索关键词
        tags.extend(["歌词", "lrc", "下载", "文件"])
        # 去重，保留首次出现顺序
        tags = list(dict.fromkeys(tags))

        info_display = []
        info_display.append(f"**发行日期:** {info['year'] or '缺少信息'}")
        if info["produce"]:
            info_display.append(f"**出品:** {info['produce']}")
        if info.get("lyric_maker"):
            info_display.append(f"**歌词制作:** {info['lyric_maker']}")
        if raw_meta_value(str(info.get("release") or "")):
            info_display.append(f"**发布:** {raw_meta_value(str(info.get('release') or ''))}")
        if raw_meta_value(str(info.get("purchase") or "")):
            info_display.append(f"**购买:** {raw_meta_value(str(info.get('purchase') or ''))}")
        if raw_meta_value(str(info.get("electronic") or "")):
            info_display.append(f"**电子:** {raw_meta_value(str(info.get('electronic') or ''))}")
        if info["vocal"]:
            info_display.append(f"**演唱:** {'、'.join(info['vocal'])}")
        if info["lyricist"]:
            info_display.append(f"**作词:** {'、'.join(info['lyricist'])}")
        if info["composer"]:
            info_display.append(f"**作曲:** {'、'.join(info['composer'])}")
        if info.get("arranger"):
            info_display.append(f"**编曲:** {'、'.join(info['arranger'])}")
        if info["tuning"]:
            info_display.append(f"**调校:** {'、'.join(info['tuning'])}")
        if info.get("illustrator"):
            info_display.append(f"**曲绘:** {'、'.join(info['illustrator'])}")
        if info.get("mixer"):
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

{f'<img src="./{album_file_name}{cover_display_ext}" alt="{album} 封面" style="max-width: 40%; height: auto;" />' if has_cover else ''}

{((chr(10) + chr(10)).join(info_display) + chr(10)) if info_display else ''}
## 曲目列表

{song_lines}

## 下载

下载本专辑所有歌词文件：[ZIP 打包下载](https://cdn.jsdelivr.net/gh/{REPO}@main/pack/{urllib.parse.quote(album)}.zip)
"""

        (ALBUMS_DIR / f"{album_file_name}.md").write_text(md_content, encoding="utf-8")

        # 首页卡片图片路径：使用绝对路径（以 / 开头），VuePress会从网站根目录解析
        cover_url = f"/albums/{album_file_name}{cover_display_ext}" if has_cover else ""
        album_cards.append(
            {
                "name": album,
                "file_name": album_file_name,
                "cover": cover_url,
                "produce": str(info["produce"] or "缺少信息"),
                "year": str(info["year"] or "缺少信息"),
                "tags": tags,
            }
        )

    album_cards.sort(key=lambda card: parse_sortable_date(str(card["year"])), reverse=True)

    cards_text = []
    for card in album_cards:
        cover_img = (
            f"<img src=\"{card['cover']}\" style=\"float: left; width: 150px; height: auto; margin-right: 20px; border-radius: 4px;\">"
            if card["cover"]
            else ""
        )

        year_line = f"**发行日期：** {card['year']}"
        tags_line = "、".join(card["tags"]) if card.get("tags") else ""
        zip_url = f"https://cdn.jsdelivr.net/gh/{REPO}@main/pack/{urllib.parse.quote(card['name'])}.zip"

        cards_text.append(
            f"""{cover_img}

### [{card['name']}](albums/{card['file_name']}.md)

出品：{card['produce']}  
{year_line}

[ZIP 下载]({zip_url})

<div style=\"clear: both;\"></div>

---
"""
        )

    docs_readme = f"""---
icon: material-symbols:home
title: 首页
heroText: 虚拟歌姬 LRC 歌词分享
tagline: 虚拟歌姬虚拟歌姬团体的歌词资源库
---

## 关于本站

本站收录并整理虚拟歌姬官方及第三方专辑的 LRC 歌词文件，方便爱好者在线浏览和下载使用。

所有歌词资源遵循 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可协议。本站仅收集网上公开资源。

## 专辑列表

{''.join(cards_text)}

## 资源说明

- 📝 点击专辑名称查看完整歌词列表
- 📥 支持单曲下载和专辑打包下载
- 🔍 使用顶部搜索框快速查找歌曲

::: tip 版权声明
所有歌词版权归原作者或版权所有方所有，请勿用于商业目的。
:::
"""

    (DOCS_DIR / "README.md").write_text(docs_readme, encoding="utf-8")

    print("MD files generated successfully.")
    print(f"Generated {len(albums)} album pages and docs/README.md")


if __name__ == "__main__":
    main()
