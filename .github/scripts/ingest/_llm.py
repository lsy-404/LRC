#!/usr/bin/env python3
"""ingest/_llm.py — OpenAI 兼容 LLM 助手，支持纯文本与视觉（image_url）消息。

复用与 lib/llm_client.py 相同的环境变量约定：
    LLM_API_KEY    必填，API 密钥
    LLM_API_BASE   端点（默认 https://api.openai.com/v1，与 config.toml [llm]
                   一致，全项目单一 OpenAI key；显式设成 OpenRouter 端点时
                   自动改走免费模型候选池逻辑）
    LLM_MODEL      文本任务默认模型（校对/编排），缺省用 gpt-5-mini
    OCR_MODEL      视觉任务模型（OCR），缺省用 gpt-5-mini

仅依赖标准库 urllib，与项目现有脚本保持零额外依赖。
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib import request
from urllib.error import HTTPError, URLError

OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"
OPENAI_API_BASE = "https://api.openai.com/v1"
DEFAULT_API_BASE = OPENAI_API_BASE
# OpenRouter 免费模型兜底（仅当 LLM_API_BASE 显式指向 OpenRouter 时使用）
DEFAULT_TEXT_MODEL = "deepseek/deepseek-chat-v3-0324:free"
DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-exp:free"
# 与 .github/config/config.toml 的 [llm] 一致：全项目单一 OpenAI key/模型
OPENAI_TEXT_MODEL = "gpt-5-mini"
OPENAI_VISION_MODEL = "gpt-5-mini"
_MODEL_CACHE: dict[str, Optional[str]] = {}


class LLMError(RuntimeError):
    """LLM 调用最终失败（重试用尽）。"""


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default) or default


def api_key() -> str:
    key = _env("LLM_API_KEY")
    if not key:
        raise LLMError("未设置 LLM_API_KEY 环境变量")
    return key


def api_base() -> str:
    return _env("LLM_API_BASE", DEFAULT_API_BASE).rstrip("/")


def _is_openrouter(base: str) -> bool:
    return "openrouter.ai" in base


def _model_id(model: dict[str, Any]) -> str:
    return str(model.get("id") or "")


def _is_free_model(model: dict[str, Any]) -> bool:
    model_id = _model_id(model)
    if model_id.endswith(":free"):
        return True
    pricing = model.get("pricing")
    if not isinstance(pricing, dict):
        return False
    return all(str(pricing.get(key, "1")) in {"0", "0.0", "0.000000"} for key in ("prompt", "completion"))


def _modalities(model: dict[str, Any]) -> set[str]:
    arch = model.get("architecture")
    values: list[str] = []
    if isinstance(arch, dict):
        raw_input = arch.get("input_modalities")
        if isinstance(raw_input, list):
            values.extend(str(v).lower() for v in raw_input)
        values.append(str(arch.get("modality") or "").lower())
    values.append(str(model.get("modality") or "").lower())
    text = " ".join(values)
    found = {"text"} if "text" in text or not text.strip() else set()
    if "image" in text or "vision" in text:
        found.add("image")
    return found


def _free_model_score(model_id: str) -> tuple[int, str]:
    preferred = ("gemini", "qwen", "deepseek", "mistral", "llama")
    for index, name in enumerate(preferred):
        if name in model_id:
            return (index, model_id)
    return (len(preferred), model_id)


def _fetch_openrouter_models() -> list[dict[str, Any]]:
    headers = {"Accept": "application/json"}
    key = _env("LLM_API_KEY")
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = request.Request(f"{api_base()}/models", headers=headers, method="GET")
    with request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    data = payload.get("data") if isinstance(payload, dict) else None
    return data if isinstance(data, list) else []


_CANDIDATES_CACHE: dict[str, list[str]] = {}


def _free_model_candidates(kind: str) -> list[str]:
    """OpenRouter 免费模型候选池，按偏好排序（非仅单个），供调用失败时换模型重试用。"""
    cache_key = f"{api_base()}:{kind}"
    if cache_key in _CANDIDATES_CACHE:
        return _CANDIDATES_CACHE[cache_key]
    candidates: list[str] = []
    try:
        for model in _fetch_openrouter_models():
            model_id = _model_id(model)
            if not model_id or not _is_free_model(model):
                continue
            modalities = _modalities(model)
            if kind == "vision" and "image" not in modalities:
                continue
            candidates.append(model_id)
        candidates.sort(key=_free_model_score)
    except Exception as e:
        print(f"⚠️  OpenRouter 免费模型列表获取失败: {e}", file=sys.stderr, flush=True)
    _CANDIDATES_CACHE[cache_key] = candidates
    return candidates


def _auto_free_model(kind: str) -> Optional[str]:
    cache_key = f"{api_base()}:{kind}"
    if cache_key in _MODEL_CACHE:
        return _MODEL_CACHE[cache_key]
    candidates = _free_model_candidates(kind)
    selected = candidates[0] if candidates else None
    _MODEL_CACHE[cache_key] = selected
    if selected:
        print(f"✓ 自动选择 OpenRouter 免费{('视觉' if kind == 'vision' else '文本')}模型: {selected}", file=sys.stderr, flush=True)
    return selected


def text_model() -> str:
    explicit = _env("LLM_MODEL")
    if explicit:
        return explicit
    base = api_base()
    if _is_openrouter(base):
        return _auto_free_model("text") or DEFAULT_TEXT_MODEL
    if base == OPENAI_API_BASE:
        return OPENAI_TEXT_MODEL
    return DEFAULT_TEXT_MODEL


def vision_model() -> str:
    explicit = _env("OCR_MODEL") or _env("LLM_MODEL")
    if explicit:
        return explicit
    base = api_base()
    if _is_openrouter(base):
        return _auto_free_model("vision") or DEFAULT_VISION_MODEL
    if base == OPENAI_API_BASE:
        return OPENAI_VISION_MODEL
    return DEFAULT_VISION_MODEL


def encode_image_data_url(path: str | Path) -> str:
    """把本地图片编码成 data:URL，供 image_url content 使用。"""
    p = Path(path)
    mime, _ = mimetypes.guess_type(p.name)
    if mime is None or not mime.startswith("image/"):
        mime = "image/png"
    return encode_image_bytes_data_url(p.read_bytes(), mime)


def encode_image_bytes_data_url(data: bytes, mime: str = "image/jpeg") -> str:
    """把已在内存中的图片字节编码成 data:URL（如方向已校正过的图片）。"""
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def chat(
    messages: list[dict[str, Any]],
    *,
    model: Optional[str] = None,
    max_tokens: int = 4000,
    timeout: int = 120,
    max_retries: int = 3,
) -> str:
    """调用 /chat/completions，返回文本内容。失败抛 LLMError。

    messages 支持 OpenAI 多模态格式：content 可为 str，或
    [{"type":"text","text":...}, {"type":"image_url","image_url":{"url":...}}]。
    """
    url = f"{api_base()}/chat/completions"
    payload = {
        "model": model or text_model(),
        "messages": messages,
        "max_completion_tokens": max_tokens,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key()}",
    }
    if _is_openrouter(api_base()):
        # OpenRouter 要求/推荐调用方带上来源标识；免费模型的网关在缺这两个头时
        # 观察到会统一返回 401 Missing Authentication header（与具体模型无关）。
        headers["HTTP-Referer"] = "https://github.com/wuyilingwei/LRC"
        headers["X-Title"] = "LRC Ingest Pipeline"
    data = json.dumps(payload).encode("utf-8")

    last_err: str = ""
    for attempt in range(max_retries + 1):
        req = request.Request(url, data=data, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            choice = (result.get("choices") or [{}])[0]
            content = ((choice.get("message") or {}).get("content") or "").strip()
            if not content:
                # 空补全（例如触发了内容审核但没有报错，finish_reason 常见
                # "content_filter"/"length"）不该当成功返回——调用方（proofread
                # 的失败回退、booklet 分轨的兜底单轨逻辑）依赖 LLMError 才会
                # 触发，静默返回空字符串会让上游好不容易识别出的文本被无声吞掉。
                last_err = f"空补全 finish_reason={choice.get('finish_reason')}"
                if attempt < max_retries:
                    time.sleep(2 ** attempt)
                continue
            return content
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8")[:300]
            except Exception:
                pass
            last_err = f"HTTP {e.code} {e.reason} {body}"
            # 4xx（除 429）通常不可重试
            if 400 <= e.code < 500 and e.code != 429:
                break
        except (URLError, KeyError, json.JSONDecodeError) as e:
            last_err = str(e)
        if attempt < max_retries:
            time.sleep(2 ** attempt)
    raise LLMError(f"LLM 请求失败: {last_err}")


def chat_safe(messages: list[dict[str, Any]], **kw: Any) -> Optional[str]:
    """chat() 的不抛版本：失败返回 None 并打印告警。"""
    try:
        return chat(messages, **kw)
    except LLMError as e:
        print(f"⚠️  {e}", file=sys.stderr, flush=True)
        return None


def chat_auto(
    messages: list[dict[str, Any]],
    *,
    kind: str,
    max_tokens: int = 4000,
    timeout: int = 120,
    max_model_attempts: int = 4,
) -> str:
    """跟 chat() 一样，但在「未显式指定模型、走 OpenRouter 自动选免费模型」时，
    单个候选模型调用失败会自动换下一个候选重试，而不是直接判定整次调用失败。

    OpenRouter 免费模型列表不稳定，个别模型偶发路由/鉴权异常（如某次自动选中的
    视觉模型对所有请求返回 401 Missing Authentication header）不应让整次
    OCR/编排全灭——这类问题在候选池里换一个模型通常就能绕过。

    kind: "text" 或 "vision"。显式设置 LLM_MODEL/OCR_MODEL，或端点不是 OpenRouter 时，
    退化为单模型调用（没有候选池概念可换）。
    """
    explicit = _env("OCR_MODEL" if kind == "vision" else "LLM_MODEL")
    if explicit or not _is_openrouter(api_base()):
        model = vision_model() if kind == "vision" else text_model()
        return chat(messages, model=model, max_tokens=max_tokens, timeout=timeout)

    candidates = _free_model_candidates(kind)
    if not candidates:
        default = DEFAULT_VISION_MODEL if kind == "vision" else DEFAULT_TEXT_MODEL
        return chat(messages, model=default, max_tokens=max_tokens, timeout=timeout)

    last_err: Optional[LLMError] = None
    for model_id in candidates[:max_model_attempts]:
        try:
            return chat(messages, model=model_id, max_tokens=max_tokens, timeout=timeout, max_retries=1)
        except LLMError as e:
            print(f"⚠️  模型 {model_id} 调用失败，换下一个候选: {e}", file=sys.stderr, flush=True)
            last_err = e
    raise last_err or LLMError("所有候选免费模型均调用失败")


def chat_auto_safe(messages: list[dict[str, Any]], *, kind: str, **kw: Any) -> Optional[str]:
    """chat_auto() 的不抛版本：失败返回 None 并打印告警。"""
    try:
        return chat_auto(messages, kind=kind, **kw)
    except LLMError as e:
        print(f"⚠️  {e}", file=sys.stderr, flush=True)
        return None


def extract_json(text: str) -> Optional[Any]:
    """从 LLM 输出里抽第一个 JSON 对象/数组（容忍 markdown 代码块包裹）。"""
    if not text:
        return None
    stripped = text.strip()
    # 去掉 ```json ... ``` 包裹
    if stripped.startswith("```"):
        stripped = stripped.split("```", 2)
        stripped = stripped[1] if len(stripped) > 1 else text
        if stripped.lstrip().startswith("json"):
            stripped = stripped.lstrip()[4:]
    # 找第一个 { 或 [
    for opener, closer in (("{", "}"), ("[", "]")):
        start = stripped.find(opener)
        end = stripped.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(stripped[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None
