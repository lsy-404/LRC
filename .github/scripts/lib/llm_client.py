#!/usr/bin/env python3
"""LLM客户端，用于智能解析专辑名称

支持OpenAI兼容的API端点
"""
import json
import os
from typing import Optional
from urllib import request
from urllib.error import HTTPError, URLError


class LLMClient:
    """OpenAI兼容格式的LLM客户端"""
    
    def __init__(
        self,
        api_base: str,
        api_key: str,
        model: str = "gpt-4o-mini",
        timeout: int = 30,
        max_retries: int = 2
    ):
        """初始化LLM客户端
        
        Args:
            api_base: API端点地址（如 https://api.openai.com/v1）
            api_key: API密钥
            model: 模型名称
            timeout: 请求超时时间（秒）
            max_retries: 最大重试次数
        """
        self.api_base = api_base.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries
    
    def _make_request(self, messages: list[dict], temperature: float = 0.1) -> Optional[str]:
        """发送请求到LLM API
        
        Args:
            messages: 消息列表
            temperature: 温度参数（0-1）
            
        Returns:
            LLM返回的文本内容，失败返回None
        """
        url = f"{self.api_base}/chat/completions"
        
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": 200
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        data = json.dumps(payload).encode('utf-8')
        req = request.Request(url, data=data, headers=headers, method='POST')
        
        for attempt in range(self.max_retries + 1):
            try:
                with request.urlopen(req, timeout=self.timeout) as response:
                    result = json.loads(response.read().decode('utf-8'))
                    return result['choices'][0]['message']['content'].strip()
            except (HTTPError, URLError, KeyError, json.JSONDecodeError) as e:
                if attempt < self.max_retries:
                    continue
                print(f"⚠️  LLM请求失败: {e}")
                return None
        
        return None
    
    def parse_album_name(self, folder_name: str) -> Optional[dict]:
        """解析专辑名称，返回结构化数据
        
        Args:
            folder_name: 文件夹名称
            
        Returns:
            包含 prefix, zh_name, en_name, suffix 的字典，失败返回None
            
        Example:
            >>> client.parse_album_name("平行四界Quadimension X-1")
            {"prefix": "", "zh_name": "平行四界", "en_name": "Quadimension", "suffix": "X-1"}
        """
        system_prompt = """你是一个专辑名称解析专家。请将专辑文件夹名称解析为四个部分：

1. prefix: 前缀标记（如系列标记、第一季等，如果没有则为空字符串）
2. zh_name: 中文主名称（如果没有中文则为空字符串）
3. en_name: 英文主名称（如果没有英文则为空字符串）
4. suffix: 后缀标记（如版本号、卷号等，如II、EP、X-1等，如果没有则为空字符串）

规则：
- 罗马数字（I, II, III等）、卷号标记（X-1, X-2等）、版本标记（EP, OST等）应归为suffix
- 中文名和英文名应该是完整的主标题，不包含版本标记
- 如果名称中同时有中英文，请分别提取
- 如果只有中文或只有英文，另一个字段留空
- prefix 通常在名称最前面，表示系列、季度等信息
- 输出必须是有效的JSON格式

请直接返回JSON，不要有任何其他文字。格式如下：
{"prefix": "", "zh_name": "", "en_name": "", "suffix": ""}"""

        user_prompt = f"请解析以下专辑名称：{folder_name}"
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        response = self._make_request(messages)
        if not response:
            return None
        
        try:
            # 尝试解析JSON
            result = json.loads(response)
            
            # 验证返回的字段
            if not isinstance(result, dict):
                return None
            
            return {
                "prefix": str(result.get("prefix", "")).strip(),
                "zh_name": str(result.get("zh_name", "")).strip(),
                "en_name": str(result.get("en_name", "")).strip(),
                "suffix": str(result.get("suffix", "")).strip()
            }
        except json.JSONDecodeError:
            print(f"⚠️  LLM返回非JSON格式: {response}")
            return None


def create_llm_client_from_config(config: dict) -> Optional[LLMClient]:
    """从配置创建LLM客户端
    
    Args:
        config: 配置字典（config.toml中的[llm]段）
        
    Returns:
        LLMClient实例，如果未启用或配置错误返回None
    """
    if not config.get("enabled", False):
        return None
    
    # 从环境变量读取API密钥（优先级高于配置文件）
    api_key = os.environ.get("LLM_API_KEY") or config.get("api_key")
    if not api_key:
        print("⚠️  未配置LLM_API_KEY环境变量，禁用LLM解析")
        return None
    
    # 从环境变量读取API端点（优先级高于配置文件）
    api_base = os.environ.get("LLM_API_BASE") or config.get("api_base", "https://api.openai.com/v1")
    model = os.environ.get("LLM_MODEL") or config.get("model", "gpt-4o-mini")
    
    return LLMClient(
        api_base=api_base,
        api_key=api_key,
        model=model,
        timeout=config.get("timeout", 30),
        max_retries=config.get("max_retries", 2)
    )
