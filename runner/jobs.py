"""三类作业：摄取 Phase A / Phase B / 站点数据生成。

管道脚本不烘进镜像，每次从仓库稀疏浅克隆 `.github/` 取用，改脚本无需重建镜像；
镜像只提供运行时（ffmpeg / tesseract / Python 依赖）。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import gh
import pack
import store

REPO = os.environ.get("GH_REPO", "lsy-404/LRC")
LYRIC_MAKER = os.environ.get("LYRIC_MAKER", "")
BOT_NAME = "lrc-ingest[bot]"
BOT_EMAIL = "lrc-ingest@users.noreply.github.com"
FAILURE_OUTPUT_LINES = 12
FAILURE_OUTPUT_CHARS = 1200
COMMAND_TIMEOUT_SECONDS = 55 * 60


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _redact(value: str, redact: str) -> str:
    return value.replace(redact, "***") if redact else value


def _failure_output_tail(proc: subprocess.CompletedProcess, redact: str) -> str:
    chunks = []
    for name, output in (("stderr", proc.stderr), ("stdout", proc.stdout)):
        lines = str(output or "").strip().splitlines()[-FAILURE_OUTPUT_LINES:]
        chunks.extend(f"[{name}] {_redact(line, redact)}" for line in lines)
    detail = "\n".join(chunks)
    if len(detail) > FAILURE_OUTPUT_CHARS:
        detail = "…" + detail[-(FAILURE_OUTPUT_CHARS - 1):]
    return detail


def run(cmd: list[str], log, *, cwd: Path | None = None, env: dict | None = None,
        redact: str = "") -> str:
    shown = " ".join(cmd)
    shown = _redact(shown, redact)
    log(f"$ {shown}")
    try:
        proc = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})},
                              capture_output=True, text=True, timeout=COMMAND_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        detail = _failure_output_tail(exc, redact)
        suffix = f"\n{detail}" if detail else ""
        raise RuntimeError(f"命令超时({COMMAND_TIMEOUT_SECONDS}秒): {shown}{suffix}") from exc
    tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-40:]
    for line in tail:
        log(f"  {_redact(line, redact)}")
    if proc.returncode != 0:
        detail = _failure_output_tail(proc, redact)
        suffix = f"\n{detail}" if detail else ""
        raise RuntimeError(f"命令失败({proc.returncode}): {shown}{suffix}")
    return proc.stdout


def _clone_scripts(work: Path, log) -> Path:
    """只取 .github/：管道脚本与配置，几 MB，不碰 res/pack 等大目录。"""
    repo = work / "repo"
    run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
         f"https://github.com/{REPO}.git", str(repo)], log)
    run(["git", "-C", str(repo), "sparse-checkout", "set", ".github"], log)
    return repo


def _clone_full(work: Path, log) -> Path:
    """生成作业要读遍 res/ 并写回 docs/pack，需要完整工作树（无历史）。"""
    repo = work / "repo"
    token = gh.TOKEN
    url = f"https://x-access-token:{token}@github.com/{REPO}.git"
    run(["git", "clone", "--depth", "1", url, str(repo)], log, redact=token)
    run(["git", "-C", str(repo), "config", "user.name", BOT_NAME], log)
    run(["git", "-C", str(repo), "config", "user.email", BOT_EMAIL], log)
    return repo


def _pipeline_env(repo: Path) -> dict:
    return {"PYTHONPATH": str(repo / ".github" / "scripts")}


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def _progress(report, stage: str, value: int, message: str) -> None:
    if report:
        report(stage, value, message)


def phase_a(params: dict, log, report=None) -> dict:
    """原料 → 成品草稿 bundle，停在人工闸门。"""
    ref = params["ref"]
    manifest = store.get_json(f"web/{ref}/manifest.json") or {}
    album = manifest.get("album") or ""
    submission_type = str(manifest.get("submission_type") or "album").strip().casefold()
    files = manifest.get("files") or []
    contributor = manifest.get("contributor") or "web"
    if not album or not files:
        raise RuntimeError(f"取料清单缺 album/files: web/{ref}/manifest.json")
    if submission_type not in {"album", "single"}:
        raise RuntimeError(f"取料清单投稿类型无效: web/{ref}/manifest.json")
    target_album = "单曲" if submission_type == "single" else album

    work = Path(tempfile.mkdtemp(prefix="phase-a-"))
    try:
        _progress(report, "downloading", 8, "正在读取投稿清单")
        payload = work / "payload" / target_album
        total = 0
        for index, f in enumerate(files, start=1):
            total += store.download(f"web/{ref}/{f['n']}", payload / f["path"],
                                    int(f.get("size") or 0))
            _progress(report, "downloading", 8 + round(17 * index / len(files)),
                      f"正在读取原料（{index}/{len(files)}）")
        log(f"取料 {len(files)} 个文件 / {total} 字节 → payload/{target_album}/")

        _progress(report, "cloning", 28, "正在准备处理脚本")
        repo = _clone_scripts(work, log)
        res_dir = repo / "res"
        res_dir.mkdir(parents=True, exist_ok=True)
        pulled = gh.pull_album(target_album, res_dir)
        if pulled:
            log(f"已有专辑「{target_album}」{len(pulled)} 个文件 → 增补模式")

        bundle_root = work / "bundle"
        summary_path = work / "summary.json"
        _progress(report, "processing", 40, "正在识别、转写与对齐")
        cmd = ["python", "-m", "ingest.pipeline", "--phase", "a",
               "--src", str(work / "payload"), "--res-dir", str(res_dir),
               "--bundle-root", str(bundle_root), "--timestamp", _now(),
               "--work", str(work / "ingest_work"), "--json", str(summary_path),
               "--contributor", contributor, "--submission-type", submission_type]
        if LYRIC_MAKER:
            cmd += ["--lyric-maker", LYRIC_MAKER]
        run(cmd, log, cwd=repo, env=_pipeline_env(repo))

        summary = _read_json(summary_path)
        if not bundle_root.is_dir() or not any(bundle_root.iterdir()):
            log("Phase A 未产出 bundle")
            return {"result": "empty", "summary": summary}

        _progress(report, "writing_review", 88, "正在写入审核草稿")
        keys = store.put_tree(bundle_root, f"review/{ref}")
        log(f"草稿 {len(keys)} 个对象 → review/{ref}/")
        return {"result": "ok", "album": summary.get("album", album),
                "objects": len(keys), "summary": summary}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def phase_b(params: dict, log, report=None) -> dict:
    """（可能被人工校正过的）草稿 → res/<专辑>/ → 开 PR 走审计。"""
    ref = params["ref"]

    work = Path(tempfile.mkdtemp(prefix="phase-b-"))
    try:
        _progress(report, "loading_review", 8, "正在读取审核草稿")
        review = work / "review"
        got = store.get_tree(f"review/{ref}", review)
        if not got:
            log(f"review/{ref}/ 不存在（已被处理或丢弃），跳过")
            return {"result": "empty"}

        _progress(report, "cloning", 20, "正在准备处理脚本")
        repo = _clone_scripts(work, log)
        res_dir = repo / "res"
        res_dir.mkdir(parents=True, exist_ok=True)

        summary_path = work / "summary.json"
        _progress(report, "aligning", 40, "正在对齐并整理歌词")
        run(["python", "-m", "ingest.pipeline", "--phase", "b",
             "--bundle-root", str(review), "--res-dir", str(res_dir),
             "--json", str(summary_path)], log, cwd=repo, env=_pipeline_env(repo))
        summary = _read_json(summary_path)
        # album 是给人看的合并串（多张专辑用顿号连），落盘要按 albums 逐张来
        album = summary.get("album", "")
        names = [a.get("album") for a in (summary.get("albums") or [])
                 if a.get("result") == "ok" and a.get("album")]
        if not names or summary.get("result") != "ok":
            log("Phase B 未产出 res 改动")
            return {"result": "empty", "summary": summary}

        status = {}
        for st in sorted(review.rglob("status.json")):
            status = _read_json(st)
            break
        contributor = status.get("contributor") or "web"
        is_update = bool(summary.get("is_update"))
        single_albums = {
            item.get("album") for item in (summary.get("albums") or [])
            if item.get("result") == "ok" and item.get("submission_type") == "single"
        }

        _progress(report, "metadata", 70, "正在补充发布信息")
        for name in names:
            if name in single_albums:
                # 单曲目录只提交本次歌词，不能让元信息补全器新建或覆盖 meta.toml。
                log(f"单曲「{name}」跳过专辑元信息补充")
                continue
            try:
                run(["python", ".github/scripts/fetch_bilibili_meta.py", "--album", name,
                     "--auto", "--fields", "release,year,electronic"],
                    log, cwd=repo, env=_pipeline_env(repo))
            except RuntimeError as e:
                log(f"补发行元信息失败（不阻断）：{e}")

        verb = "update" if is_update else "ingest"
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        slug = "".join(c if c.isalnum() or c == "-" else "-" for c in contributor.lower()).strip("-")
        branch = f"ingest-{slug or 'web'}-{ts}"
        _progress(report, "opening_pr", 88, "正在创建审核请求")
        pushed = gh.commit_albums(names, res_dir, branch=branch,
                                  message=f"{verb}: {album} (via upload by @{contributor})")
        if not pushed:
            log("与 main 内容一致，无需开 PR")
            return {"result": "nochange", "album": album, "summary": summary}

        body = "\n".join([
            f"### 自动摄取 — {'增补已有专辑数据' if is_update else '新专辑摄取投稿（经人工闸门校正）'}",
            "",
            f"- 投稿者：@{contributor}",
            f"- 专辑：`{album}`",
            f"- ref：`{ref}`",
            f"- 来源：网页投稿 → Phase A 草稿 → 人工闸门 → Phase B 对齐（原料持续保留于 R2）",
            "",
            "<details><summary>处理摘要</summary>",
            "",
            "```json",
            json.dumps(summary, ensure_ascii=False, indent=2),
            "```",
            "</details>",
            "",
            "> 歌词为机器转写、meta 为模型抽取，已经人工闸门校正；仍请复核后再依赖自动合并。",
        ])
        pr = gh.open_pr(branch, f"{verb}: {album} (@{contributor})", body)
        log(f"已开 PR #{pr.get('number')} ← {branch}")

        store.put_json(f"web/{ref}/.used",
                       {"ref": ref, "album": album, "used_at": _now()})
        removed = store.delete_prefix(f"review/{ref}/")
        log(f"已标记原料 .used 并清理 review/{ref}/（{removed} 个对象）")

        return {"result": "ok", "album": album, "pr": pr.get("number"),
                "branch": branch, "summary": summary}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def generate(params: dict, log, report=None) -> dict:
    """res/ → meta 补全 / 压缩包 / 目录页 / 静态 API / 报告，提交回 main 并触发部署。"""
    force = bool(params.get("force"))

    work = Path(tempfile.mkdtemp(prefix="generate-"))
    try:
        _progress(report, "cloning", 8, "正在准备生成环境")
        repo = _clone_full(work, log)
        env = _pipeline_env(repo)

        _progress(report, "metadata", 25, "正在整理元信息")
        run(["python", ".github/scripts/generate_meta.py"], log, cwd=repo, env=env)

        _progress(report, "packing", 45, "正在重建专辑压缩包")
        result = pack.rebuild(repo / "res", repo / "pack", force=force)
        log(f"压缩包：新建/更新 {len(result['built'])}、清理 {len(result['removed'])}、"
            f"跳过 {result['skipped']}")

        _progress(report, "optimizing", 62, "正在优化站点内容")
        run(["python", ".github/scripts/optimize.py"], log, cwd=repo, env=env)

        albums_dir = repo / "docs" / "albums"
        shutil.rmtree(albums_dir, ignore_errors=True)
        albums_dir.mkdir(parents=True, exist_ok=True)

        _progress(report, "building", 76, "正在生成目录与 API")
        for script in ("generate_md.py", "generate_api.py", "generate_report.py"):
            run(["python", f".github/scripts/{script}"], log, cwd=repo, env=env)

        run(["git", "add", "README.md", "pack", "docs", "res"], log, cwd=repo)
        changed = run(["git", "status", "--porcelain"], log, cwd=repo).strip()
        if not changed:
            log("无生成物变化")
            return {"result": "nochange"}

        _progress(report, "publishing", 92, "正在发布生成结果")
        run(["git", "commit", "-m", "chore: optimize tags, update catalog and generate pages"],
            log, cwd=repo)
        run(["git", "push", "origin", "HEAD:main"], log, cwd=repo, redact=gh.TOKEN)

        gh.dispatch_workflow("deploy.yml")
        log("已触发站点构建部署")
        return {"result": "ok", "packs": result}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def diag(params: dict, log, report=None) -> dict:
    """自检：确认镜像里该有的外部命令都在，并打通一次对象存储往返。"""
    versions = {}
    _progress(report, "diagnosing", 15, "正在检查处理环境")
    for name, cmd in (("python", ["python", "-V"]), ("ffmpeg", ["ffmpeg", "-version"]),
                      ("ffprobe", ["ffprobe", "-version"]), ("git", ["git", "--version"]),
                      ("tesseract", ["tesseract", "--version"])):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            versions[name] = (out.stdout or out.stderr).strip().splitlines()[0]
        except Exception as e:  # noqa: BLE001
            versions[name] = f"缺失: {e}"

    _progress(report, "diagnosing", 65, "正在验证对象存储")
    probe_key = "review/.diag/probe"
    payload = json.dumps({"at": _now()}).encode("utf-8")
    store.put_bytes(probe_key, payload)
    ok = store.get_bytes(probe_key) == payload
    store.delete_prefix("review/.diag/")
    log(f"对象存储往返：{'一致' if ok else '不一致'}")

    # 仓库令牌够不够用：开 PR 只要 pull，缝树建分支与推生成物要 push
    _progress(report, "diagnosing", 85, "正在检查仓库权限")
    repo_perm = {}
    if gh.TOKEN:
        try:
            info = gh.api("GET", f"/repos/{REPO}") or {}
            repo_perm = info.get("permissions") or {}
            log(f"仓库权限：{repo_perm}")
        except RuntimeError as e:
            repo_perm = {"error": str(e)[:120]}
            log(f"仓库权限探测失败：{e}")

    return {"result": "ok" if ok else "store-mismatch", "versions": versions,
            "repo": REPO, "repo_permissions": repo_perm,
            "lyric_maker_set": bool(LYRIC_MAKER),
            "gh_token_set": bool(gh.TOKEN), "llm_key_set": bool(os.environ.get("LLM_API_KEY")),
            "ocr_model": os.environ.get("OCR_MODEL", ""),
            "llm_base": os.environ.get("LLM_API_BASE", "")}


HANDLERS = {"phase_a": phase_a, "phase_b": phase_b, "generate": generate, "diag": diag}
