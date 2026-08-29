# 操作记录

- 创建独立 worktree `LRC-container-audio`，分支 `codex/container-audio-pipeline`，起点 `d1b8fe7`。
- 阅读 agent-mode、Cloudflare、Wrangler、Workers best practices 规范及项目审计索引。
- 比对 8c3e20e、349eeae 与各自父提交，确认应撤销前端/Worker 转写分流并恢复 Container 路径。
- 移除 MediaBunny 及浏览器压缩器，恢复原始文件上传、Container 下载和 Container 内转写；Worker 保留 R2 清单/对象预检。
- 让 `ingest.stt` 对兼容且不超过 25,000,000 字节的原音直送，其余走 Container ffmpeg，并添加条件分流回归测试。
- 新增前端原始文件/无浏览器转码、basic Container 配置，以及 Container 原始音频 tag/封面提取回归测试。
- 安装 worktree 依赖后，VuePress 构建及 Node/Python 回归通过；`wrangler types` 已生成并校验临时类型，未将生成文件纳入提交。
