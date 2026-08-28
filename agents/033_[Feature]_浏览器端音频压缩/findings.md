# Findings

- [现有上传] -> `UploadBox.vue` 以 `File` 和 `relPath` 维持条目，分片上传从 `it.file.slice()` 读取。替换音频 `File` 后可自然保留条目 UID、用途、照片关联和排序。
- [内存约束] -> 不能对一组音频并行读取或编码；必须在 Worker 中一次处理一首，且限制可转码源的大小，避免页面同时保留多个大 ArrayBuffer/WASM 内存副本。
- [转码器选择] -> `@ffmpeg/core` 解包约 64.7 MB，超过静态单资源限制，不可用。采用 Mediabunny 1.55.3：纯 TypeScript、零依赖、WebCodecs 驱动、`BlobSource` 流式读取；构建后动态 chunk 582,321 B（gzip 145,765 B），未引入 FFmpeg/WASM 静态核心。
- [格式与上游契约] -> 每条音频强制转为 `.webm`、`audio/webm`、Opus 96 kbps，最大 24 MiB、30 分钟；通过 `input.getMimeType()` 按真实内容而非扩展名识别。manifest v3 文件条目携带真实 MIME，`upload_metadata` 携带压缩前标准化 tags 与独立 `cover_path`。
- [兼容性] -> 需要 WebCodecs 的 AudioEncoder/AudioDecoder；不支持时明确报错并阻止提交，不会静默上传未压缩原料。Mediabunny 无法解码的文件同样进入可重试失败状态。
