from __future__ import annotations

import re
import shutil
import urllib.parse
from pathlib import Path

from lib.meta_parser import load_album_meta

REPO = "wuyilingwei/LRC"
ROOT_DIR = Path(__file__).resolve().parents[2]
RES_DIR = ROOT_DIR / "res"
DOCS_DIR = ROOT_DIR / "docs"
ALBUMS_DIR = DOCS_DIR / "albums"
PUBLIC_ALBUMS_DIR = DOCS_DIR / ".vuepress" / "public" / "albums"
COVER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"]


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
    PUBLIC_ALBUMS_DIR.mkdir(parents=True, exist_ok=True)


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
            parsed = parse_lrc(lrc_file)
            song_title = parsed["title"] or lrc_file.stem
            songs.append({"title": song_title, "file": lrc_file.name})

        cover_file, cover_ext = find_cover(album_dir)
        if cover_file:
            dest_cover = PUBLIC_ALBUMS_DIR / f"{album_file_name}{cover_ext}"
            shutil.copyfile(cover_file, dest_cover)

        has_cover = False
        cover_display_ext = ""
        for ext in COVER_EXTENSIONS:
            target = PUBLIC_ALBUMS_DIR / f"{album_file_name}{ext}"
            if target.exists():
                has_cover = True
                cover_display_ext = ext
                break

        tags = [album]
        if info["produce"]:
            tags.append(str(info["produce"]))
        if info["lyric_maker"]:
            tags.append(str(info["lyric_maker"]))
        for key in ("vocal", "lyricist", "composer", "tuning"):
            values = info.get(key) or []
            if isinstance(values, list):
                tags.extend(values)

        info_display = []
        if info["year"]:
            info_display.append(f"**发行日期:** {info['year']}")
        if info["produce"]:
            info_display.append(f"**出品:** {info['produce']}")
        if info["vocal"]:
            info_display.append(f"**演唱:** {'、'.join(info['vocal'])}")
        if info["lyricist"]:
            info_display.append(f"**作词:** {'、'.join(info['lyricist'])}")
        if info["composer"]:
            info_display.append(f"**作曲:** {'、'.join(info['composer'])}")
        if info["tuning"]:
            info_display.append(f"**调校:** {'、'.join(info['tuning'])}")
        if info["lyric_maker"]:
            info_display.append(f"**歌词制作:** {info['lyric_maker']}")

        release_value = raw_meta_value(str(info.get("release") or ""))
        purchase_value = raw_meta_value(str(info.get("purchase") or ""))
        electronic_value = raw_meta_value(str(info.get("electronic") or ""))
        if release_value:
            info_display.append(f"**发布:** {release_value}")
        if purchase_value:
            info_display.append(f"**购买:** {purchase_value}")
        if electronic_value:
            info_display.append(f"**电子:** {electronic_value}")

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
title: {album} 歌词 LRC
{order_line}category:
  - {album}
tag:
{''.join(f'  - {tag}\n' for tag in tags)}---

# {album}

{f'<img src="/albums/{album_file_name}{cover_display_ext}" alt="{album} 封面" style="max-width: 40%; height: auto;" />' if has_cover else ''}

{((chr(10) + chr(10)).join(info_display) + chr(10)) if info_display else ''}
**歌曲数量:** {len(songs)} 首

## 曲目列表

{song_lines}

## 下载

下载本专辑所有歌词文件：[📦 ZIP 打包下载](https://cdn.jsdelivr.net/gh/{REPO}@main/pack/{urllib.parse.quote(album)}.zip)
"""

        (ALBUMS_DIR / f"{album_file_name}.md").write_text(md_content, encoding="utf-8")

        cover_url = f"/albums/{album_file_name}{cover_display_ext}" if has_cover else ""
        album_cards.append(
            {
                "name": album,
                "file_name": album_file_name,
                "cover": cover_url,
                "song_count": len(songs),
                "produce": str(info["produce"] or "缺少信息"),
                "year": str(info["year"] or "缺少信息"),
            }
        )

    album_cards.sort(key=lambda card: parse_sortable_date(str(card["year"])), reverse=True)

    cards_text = []
    for card in album_cards:
        info_str = f"出品：{card['produce']}"
        if card["year"] != "缺少信息":
            info_str += f" | 发行日期：{card['year']}"

        cover_img = (
            f"<img src=\"{card['cover']}\" style=\"float: left; width: 150px; height: auto; margin-right: 20px; border-radius: 4px;\">"
            if card["cover"]
            else ""
        )

        cards_text.append(
            f"""{cover_img}

### [{card['name']}](albums/{card['file_name']}.md)

{info_str}  
**曲目数：** {card['song_count']} 首

[查看详情 →](albums/{card['file_name']}.md)

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
