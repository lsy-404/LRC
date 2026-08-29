# 调研结论

- [现状] 8c3e20e 将音频转写移到 Durable Object，Container 改为 lite；349eeae 同类改动把浏览器文件转成 WebM/Opus。
- [恢复路径] 8c3e20e 的父提交包含经过验证的 Container 下载原文件、`ingest.pipeline` 转写和 `ingest.stt` 的 ffmpeg 压缩路径；复用该路径，不保留 Worker 预转写侧车。现有上传清单仍使用版本 3，但不含浏览器解析的音频元数据。
- [限制] OpenAI 转写接口单文件上限为 25 MB，支持 mp3/mp4/mpeg/mpga/m4a/wav/webm，FLAC 不支持；Container 需要按大小和格式决定直送或转码。
