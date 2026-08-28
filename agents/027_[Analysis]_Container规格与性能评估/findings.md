# 调研结论

- 当前配置为 `standard-2`、`max_instances: 5`，容器空闲请求 10 分钟后休眠。
- 任务已使用云端 Whisper；Container 本地主要承担素材拉取、FFmpeg 转码、OCR、歌词对齐、草稿打包与生成。
