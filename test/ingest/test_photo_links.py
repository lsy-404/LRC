"""歌词照片一图多曲关联的数据契约。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))

from ingest import organize, pipeline  # noqa: E402


def test_extract_photo_links_accepts_legacy_string_and_new_array() -> None:
    manifest = {
        "links": {
            "booklet/page-1.jpg": "01.mp3",
            "booklet/page-2.jpg": ["01.mp3", "02.mp3", "01.mp3"],
        },
        "album": "测试",
    }
    assert pipeline.extract_photo_links(manifest) == {
        "page-1.jpg": ["01.mp3"],
        "page-2.jpg": ["01.mp3", "02.mp3"],
    }
    assert "links" not in manifest


def test_link_orders_and_annotation_keep_all_targets() -> None:
    tracks = [
        {"order": 1, "file": "01.mp3", "title": "第一首"},
        {"order": 2, "file": "02.mp3", "title": "第二首"},
    ]
    links = {"page.jpg": ["01.mp3", "02.mp3"]}
    orders = organize.link_orders_of(links, tracks)
    assert orders == {"page.jpg": [1, 2]}
    text = organize.annotate_booklet(
        [{"name": "page.jpg", "kind": "OCR", "text": "共享歌词"}],
        tracks, orders, {},
    )
    assert "已绑定曲目 1. 第一首、2. 第二首" in text


def test_enforce_page_links_reuses_shared_page_for_each_song() -> None:
    tracks = [
        {"order": 1, "file": "01.mp3"},
        {"order": 2, "file": "02.mp3"},
    ]
    result = organize.enforce_page_links(
        {}, [{"name": "page.jpg", "text": "同一页的两首歌词"}], tracks,
        {"page.jpg": [1, 2]}, {}, {},
    )
    assert result == {"1": "同一页的两首歌词", "2": "同一页的两首歌词"}
