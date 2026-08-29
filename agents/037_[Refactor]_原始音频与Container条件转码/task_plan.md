# 原始音频与 Container 条件转码

- [ ] 移除浏览器音频转码和 MediaBunny 依赖，恢复原始文件上传。
- [ ] Worker 仅校验清单与对象完整性，不执行 OpenAI 转写。
- [ ] Container 下载原始音频，兼容且不超过 25 MB 时直接转写，否则用 ffmpeg 压缩后转写。
- [ ] 将 Container 规格从 `lite` 调整为 `basic`，并保持全部音频就绪后再启动。
- [ ] 增加根目录回归测试并运行全量测试。
- [ ] 部署 Worker/Container 并完成生产浏览器验证。
