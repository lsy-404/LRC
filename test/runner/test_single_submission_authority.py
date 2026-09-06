from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "runner"))

import jobs  # noqa: E402


class SingleSubmissionAuthorityTests(unittest.TestCase):
    def _run_phase_a(self, manifest: dict):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            commands: list[list[str]] = []

            def download(_key, destination, _size):
                Path(destination).parent.mkdir(parents=True, exist_ok=True)
                Path(destination).write_text("[00:01.000]歌词\n", encoding="utf-8")
                return 1

            def run(command, _log, **_kwargs):
                commands.append(command)
                if "ingest.pipeline" in command:
                    summary = Path(command[command.index("--json") + 1])
                    summary.write_text(json.dumps({"album": "单曲", "result": "ok"}), encoding="utf-8")
                    bundle = Path(command[command.index("--bundle-root") + 1]) / "单曲"
                    bundle.mkdir(parents=True)
                return ""

            with patch.object(jobs.store, "get_json", return_value=manifest), \
                 patch.object(jobs.store, "download", side_effect=download), \
                 patch.object(jobs.store, "put_tree", return_value=["review/object"]), \
                 patch.object(jobs, "_clone_scripts", return_value=repo), \
                 patch.object(jobs.gh, "pull_album", return_value=["meta.toml"]) as pull, \
                 patch.object(jobs, "run", side_effect=run):
                result = jobs.phase_a({"ref": "a" * 32}, lambda _line: None)
            command = next(command for command in commands if "ingest.pipeline" in command)
            return result, pull.call_args.args[0], command

    def test_phase_a_passes_server_type_and_pulls_existing_single_directory(self):
        result, pulled_album, command = self._run_phase_a({
            "album": "伪造专辑", "submission_type": "single", "contributor": "web",
            "files": [{"n": 0, "path": "01 新曲.lrc", "size": 1}],
        })
        self.assertEqual(result["result"], "ok")
        self.assertEqual(pulled_album, "单曲")
        self.assertEqual(command[command.index("--submission-type") + 1], "single")

    def test_phase_a_passes_trusted_manifest_credits(self):
        _, _, command = self._run_phase_a({
            "album": "Album", "submission_type": "album", "contributor": "account",
            "lyric_maker": ["Editor", "Extra", "Editor"],
            "files": [{"n": 0, "path": "song.lrc", "size": 1}],
        })
        self.assertEqual(json.loads(command[command.index("--lyric-makers") + 1]), ["Editor", "Extra"])

    def test_phase_a_accepts_explicit_and_legacy_album_types(self):
        for manifest in (
            {"album": "普通专辑", "submission_type": "album", "contributor": "web",
             "files": [{"n": 0, "path": "01 歌词.lrc", "size": 1}]},
            {"album": "旧专辑", "contributor": "web",
             "files": [{"n": 0, "path": "01 歌词.lrc", "size": 1}]},
        ):
            result, pulled_album, command = self._run_phase_a(manifest)
            self.assertEqual(result["result"], "ok")
            self.assertEqual(pulled_album, manifest["album"])
            self.assertEqual(command[command.index("--submission-type") + 1], "album")

    def test_phase_b_single_never_invokes_album_metadata_enrichment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            commands: list[list[str]] = []

            def get_tree(_prefix, destination):
                destination = Path(destination)
                destination.mkdir(parents=True)
                destination.joinpath("status.json").write_text(
                    json.dumps({"contributor": "web", "submission_type": "single"}),
                    encoding="utf-8",
                )
                return ["status.json"]

            def run(command, _log, **_kwargs):
                commands.append(command)
                if "ingest.pipeline" in command:
                    summary = Path(command[command.index("--json") + 1])
                    summary.write_text(json.dumps({
                        "result": "ok", "album": "单曲", "is_update": True,
                        "albums": [{"album": "单曲", "result": "ok", "submission_type": "single"}],
                    }), encoding="utf-8")
                return ""

            with patch.object(jobs.store, "get_tree", side_effect=get_tree), \
                 patch.object(jobs, "_clone_scripts", return_value=repo), \
                 patch.object(jobs, "run", side_effect=run), \
                 patch.object(jobs.gh, "commit_albums", return_value=None):
                result = jobs.phase_b({"ref": "a" * 32}, lambda _line: None)

            self.assertEqual(result["result"], "nochange")
            self.assertFalse(any(any("fetch_bilibili_meta.py" in part for part in command)
                                 for command in commands))

    def test_phase_b_album_keeps_metadata_enrichment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            repo.mkdir()
            commands: list[list[str]] = []

            def get_tree(_prefix, destination):
                destination = Path(destination)
                destination.mkdir(parents=True)
                destination.joinpath("status.json").write_text(
                    json.dumps({"contributor": "web", "submission_type": "album"}),
                    encoding="utf-8",
                )
                return ["status.json"]

            def run(command, _log, **_kwargs):
                commands.append(command)
                if "ingest.pipeline" in command:
                    summary = Path(command[command.index("--json") + 1])
                    summary.write_text(json.dumps({
                        "result": "ok", "album": "普通专辑", "is_update": False,
                        "albums": [{"album": "普通专辑", "result": "ok", "submission_type": "album"}],
                    }), encoding="utf-8")
                return ""

            with patch.object(jobs.store, "get_tree", side_effect=get_tree), \
                 patch.object(jobs, "_clone_scripts", return_value=repo), \
                 patch.object(jobs, "run", side_effect=run), \
                 patch.object(jobs.gh, "commit_albums", return_value=None):
                result = jobs.phase_b({"ref": "a" * 32}, lambda _line: None)

            self.assertEqual(result["result"], "nochange")
            self.assertTrue(any(any("fetch_bilibili_meta.py" in part for part in command)
                                for command in commands))


if __name__ == "__main__":
    unittest.main()
