"""ingest — upload 投递摄取管道脚本包。

子模块：
    _llm       OpenAI 兼容 LLM 助手（含视觉 image_url 支持），复用 LLM_API_* 环境变量
    ocr        图片 → 文字（视觉模型）
    proofread  歌词草稿文字校对（LLM）
    stt        音频 → 歌词文本（本地 faster-whisper）
    organize   汇总 OCR/STT/校对结果 + manifest → res/<专辑>/ 结构
    pipeline   单入口编排：扫描投递目录，依次跑上述步骤
"""
