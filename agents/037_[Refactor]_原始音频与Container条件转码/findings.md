# Findings

- [OpenAI 限制] -> 文件转写接口单文件最多 25 MB，支持 MP3、MP4、MPEG、MPGA、M4A、WAV 和 WebM -> FLAC 或大于 25 MB 的原曲不能无条件直送。
- [目标路径] -> 前端只上传原文件；Container 对兼容且不超过限制的文件原样直送，其他文件才执行 ffmpeg 转码 -> 避免无意义的有损转换，同时不让浏览器处理音频。
- [规格] -> Cloudflare 当前 `lite` 为 1/16 vCPU、256 MiB，下一档 `basic` 为 1/4 vCPU、1 GiB -> `basic` 是适度提高转码性能的最小现成档位。
