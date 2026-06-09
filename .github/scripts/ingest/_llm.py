#!/usr/bin/env python3
"""ingest/_llm.py — OpenAI 兼容 LLM 助手，支持纯文本与视觉（image_url）消息。

复用与 lib/llm_client.py 相同的环境变量约定：
    LLM_API_KEY    必填，API 密钥
    LLM_API_BASE   端点（默认 https://api.openai.com/v1），OpenRouter 用 https://openrouter.ai/api/v1
    LLM_MODEL      文本任务默认模型（校对/编排）
    OCR_MODEL      视觉任务模型（OCR），缺省回退到 LLM_MODEL

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

DEFAULT_API_BASE = "https://api.openai.com/v1"
DEFAULT_TEXT_MODEL = "gpt-4o-mini"
# OpenRouter 免费视觉模型（列表常变，可用 OCR_MODEL 覆盖）
DEFAULT_VISION_MODEL = "google/gemini-2.0-flash-exp:free"


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


def text_model() -> str:
    return _env("LLM_MODEL", DEFAULT_TEXT_MODEL)


def vision_model() -> str:
    return _env("OCR_MODEL") or _env("LLM_MODEL") or DEFAULT_VISION_MODEL


def encode_image_data_url(path: str | Path) -> str:
    """把本地图片编码成 data:URL，供 image_url content 使用。"""
    p = Path(path)
    mime, _ = mimetypes.guess_type(p.name)
    if mime is None or not mime.startswith("image/"):
        mime = "image/png"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
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
    data = json.dumps(payload).encode("utf-8")

    last_err: str = ""
    for attempt in range(max_retries + 1):
        req = request.Request(url, data=data, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"].strip()
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
