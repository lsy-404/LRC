from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".github" / "scripts"))
from ingest import organize  # noqa: E402


def test_finalize_uses_safe_renamed_album_for_directory_and_metadata() -> None:
    root = Path(tempfile.mkdtemp())
    draft = {
        "album": "../../新专辑",
        "meta": {},
        "names": {"zh_name": "新专辑", "en_name": ""},
        "tracks": [{
            "order": 1, "title": "歌曲", "lrc": "[00:01.000]歌词\n",
            "klrc": "[00:01.000]<00:01.000>歌<00:01.100>词\n",
            "timing_locked": True, "aligned": True,
        }],
    }
    result = organize.finalize(draft, res_dir=root)
    album = root / "新专辑"
    assert result["album"] == "新专辑"
    assert (album / "1 歌曲.lrc").is_file()
    assert "中文名 = \"新专辑\"" in (album / "meta.toml").read_text(encoding="utf-8")
    assert not (root / ".." / "新专辑").exists()
