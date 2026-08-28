# 调研结论

- [无声音报告] -> [审计 `loadAudio`] -> [客户端已使用 `fetch` 后 `response.blob()`，并非直接给 `<audio>` 受认证 URL。]
- [`.mp3` 源文件实为 FLAC] -> [接口仅按扩展名返回 `audio/mpeg`] -> [浏览器可能按错误容器解码，需以对象文件头为准。]
- [切歌竞态] -> [旧请求已可 Abort] -> [增加加载代次，防止过期响应写入新曲状态。]
- [完整加载] -> [流读取 `content-length`] -> [仅每 150ms 写一次进度，完成后才创建带响应 MIME 的 Blob URL。]
- [构建] -> [`pnpm run docs:build`] -> [独立 worktree 未安装 `node_modules`，`vuepress: command not found`；源码专项测试不受影响。]
- [生产 FLAC] -> [完整认证下载、真实 MIME 均正确，但 Chromium 立即触发媒体错误] -> [`ffprobe` 提示 attached picture MIME 无法读取；只移除 type 6 PICTURE 元数据块，音频帧不变。]
