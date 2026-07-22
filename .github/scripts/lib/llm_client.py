#!/usr/bin/env python3
"""LLM客户端，用于智能解析专辑名称

支持OpenAI兼容的API端点
"""
import json
import os
import re
import sys
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
    
    def _make_request(self, messages: list[dict]) -> Optional[str]:
        """发送请求到LLM API
        
        Args:
            messages: 消息列表
            
        Returns:
            LLM返回的文本内容，失败返回None
        """
        url = f"{self.api_base}/chat/completions"
        
        # 结构化数据输出使用最简配置，不设置 temperature 等参数
        payload = {
            "model": self.model,
            "messages": messages,
            "max_completion_tokens": 2000  # GPT-5 推理模型需要更多 tokens：先推理再输出
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
            except HTTPError as e:
                # 读取错误响应体以获取详细信息
                error_body = ""
                try:
                    error_body = e.read().decode('utf-8')
                except:
                    pass
                if attempt < self.max_retries:
                    continue
                print(f"⚠️  LLM请求失败: HTTP {e.code} {e.reason}", file=sys.stderr, flush=True)
                if error_body:
                    print(f"    详细信息: {error_body[:200]}", file=sys.stderr, flush=True)
                return None
            except (URLError, KeyError, json.JSONDecodeError) as e:
                if attempt < self.max_retries:
                    continue
                print(f"⚠️  LLM请求失败: {e}", file=sys.stderr, flush=True)
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


    def extract_staff_from_desc(
        self,
        desc: str,
        album_name: str,
        missing_fields: list[str],
    ) -> Optional[dict]:
        """从视频简介中提取专辑 STAFF 信息。

        Args:
            desc:          视频简介原文
            album_name:    专辑名称（用于上下文提示）
            missing_fields: 当前缺失的字段列表（internal 名称）

        Returns:
            dict，键为 internal 字段名，值为字符串列表。
            只返回确实在简介中找到的字段，找不到的键不出现。
            失败返回 None。

        示例输出：
            {"vocal": ["洛天依"], "lyricist": ["雨狸"], "composer": ["DELA_P"],
             "arranger": ["DELA_P"], "tuning": ["纳兰寻风"],
             "illustrator": ["Lune"], "mixer": ["胡蝶Dorian"]}
        """
        # 字段映射说明（中文标签 → internal 名称）
        field_guide = {
            "vocal":       "演唱/主唱/歌手（vocalist）",
            "lyricist":    "作词/词（lyricist）",
            "composer":    "作曲/曲（composer）",
            "arranger":    "编曲/曲/混编（arranger）",
            "tuning":      "调校/调/调教（tuner）",
            "illustrator": "曲绘/封面/美术/绘（illustrator）",
            "mixer":       "混音/混（mixer）",
            "mastering":   "母带（mastering）",
            "video":       "视频/PV（video）",
            "planning":    "策划/企划（planning）",
        }
        target_guide = "\n".join(
            f'  - "{k}": {v}' for k, v in field_guide.items() if k in missing_fields
        )

        system_prompt = f"""你是一个音乐专辑元数据解析专家，专注于中文虚拟歌手（VOCALOID/UTAU）专辑。

任务：从下面的 Bilibili 视频简介中，提取专辑《{album_name}》的制作人员信息。

需要提取的字段（仅提取简介中明确出现的）：
{target_guide}

输出规则：
1. 只返回 JSON，不输出任何其他文字
2. 每个字段的值是人名数组（字符串列表）
3. 若一个字段简介中没有提及，则不要包含该键
4. 人名保留原始写法（含英文名/昵称均保留），但需去掉 @xxx 形式的 Bilibili 用户名后缀（如"温记 @Zill温记"→"温记"）
5. 同一人担任多个职位，在各自字段中分别列出
6. 若简介只列出了单曲 STAFF（分曲目列），则合并去重所有曲目的同一字段
7. 若简介中明确写了"其他staff见视频/见片尾"或类似说明，对应字段不要猜测，直接忽略

【vocal 演唱字段特别规则】：
- vocal 只能填写虚拟歌姬/合成声库的名称，例如：洛天依、言和、乐正绫、星尘、海伊、赤羽、诗岸、苍穹、心华、Minus/永夜Minus、牧心、默辰、小春六花、ナースロボ＿タイプＴ等
- 严禁填入真人（人类音乐制作人）的名字，即使简介中将其列于"演唱"字段
- 严禁填入团体/乐队名称（如"五维介质"、"霾Axis"、"平行四界"等），这类需要知道具体由哪些歌姬演唱
- 若简介中只写了团体名而未列出具体歌姬成员，则不要包含 vocal 键
- 专辑名称/团体缩写（如"洛言绫星"代指洛天依+言和+乐正绫+星尘）不应作为一个整体填入，若能明确其成员则拆分，否则忽略

【mixer 混音字段特别规则】：
- mixer 只填写简介中明确标注为"混音/混"的人员
- 严禁将"监制"、"制作人"、"母带"、"策划"等职位的人员归入 mixer
- 调校（tuning）人员不属于混音，不要混淆

输出格式（示例）：
{{"vocal": ["洛天依"], "lyricist": ["雨狸", "素珏"], "composer": ["DELA_P"], "arranger": ["胡蝶Dorian"], "tuning": ["纳兰寻风"], "illustrator": ["Lune"], "mixer": ["胡蝶Dorian"]}}"""

        user_prompt = f"视频简介：\n\n{desc[:3000]}"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ]

        response = self._make_request(messages)
        if not response:
            return None

        # 提取 JSON（LLM 有时会在前后加 markdown 代码块）
        json_match = re.search(r'\{.*\}', response, re.DOTALL)
        if not json_match:
            print(f"⚠️  LLM返回非JSON: {response[:100]}", file=sys.stderr, flush=True)
            return None

        try:
            result = json.loads(json_match.group())
        except json.JSONDecodeError:
            print(f"⚠️  JSON解析失败: {response[:100]}", file=sys.stderr, flush=True)
            return None

        if not isinstance(result, dict):
            return None

        # 清理：确保每个值是字符串列表，过滤空值，去掉 @xxx 后缀
        _at_suffix = re.compile(r'\s*@\S+$')

        def _clean_name(raw: str) -> str:
            """去掉 Bilibili @用户名 后缀，如 '温记 @Zill温记' → '温记'"""
            return _at_suffix.sub("", raw.strip()).strip()

        cleaned: dict[str, list[str]] = {}
        valid_fields = set(field_guide.keys())
        for k, v in result.items():
            if k not in valid_fields:
                continue
            if isinstance(v, list):
                names = [_clean_name(str(x)) for x in v if _clean_name(str(x))]
            elif isinstance(v, str) and v.strip():
                names = [_clean_name(v)]
                names = [n for n in names if n]
            else:
                continue
            if names:
                cleaned[k] = names

        return cleaned if cleaned else None


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
