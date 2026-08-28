# 调研与发现

- [接口限制] -> OpenAI Audio API 的单文件上限为 25 MB；原始投稿音频远超此值，Worker 不能直接将完整 R2 对象转发为一次转写请求。
- [Worker 运行限制] -> 单 isolate 内存为 128 MB；必须始终流式处理，不得读取完整音频到内存。HTTP 请求虽无墙钟上限，但客户端断开后只可由 `waitUntil` 延长约 30 秒，不能用一次浏览器请求串行完成整张专辑。
- [设计结论] -> 保留浏览器直传 R2。Worker/DO 从 R2 取得单首已压缩对象的可读流，并以流式 multipart 转发 OpenAI；每首形成独立且可恢复的状态。当前 `whisper-1` 的单文件上限为 25 MB，压缩在上传端完成，不能在 128 MB Worker 中可靠实现。
- [实现边界] -> 压缩后的音频必须由上传端写成 `manifest.version=3`、明确 `mime` 且每首不超过 25 MB。Worker 以流式 multipart 直接发送到 OpenAI，最多两首并行，逐首结果持久化到 R2；所有结果按 manifest 校验通过才启动 Container。
- [元数据] -> 压缩会丢弃音频 tag。Runner 不再读取压缩音频 tag 或内嵌封面；上传端须将压缩前元数据写入 `upload_metadata.tracks[]`，封面作为单独的图片对象上传并由 `upload_metadata.cover_path` 指向。上传端尚未提供这些字段时，不能宣称保留 tag/封面。
- [验证阻塞] -> `npx wrangler deploy --config worker/wrangler.jsonc --dry-run` 在独立 worktree 缺少 `worker/node_modules/@cloudflare/containers` 而停止；代码打包未被验证，需在已安装该依赖的主工作树重新执行。
