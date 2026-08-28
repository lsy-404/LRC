# 调研结论

- [上传路径] -> UploadBox 为单张专辑生成 `manifest.toml`，由 ingest 的 `organize.merge_meta` 消费。-> 署名可作为 `lyric_maker` 专辑元数据，不需要修改任何 LRC。
- [草稿] -> uploadDraft 仅持久化专辑名和文件人工设置。-> 需扩展为保存专辑级署名。
- [LRC 权威性] -> authoritative_lrc 已锁定标准 LRC 的字和时间戳。-> 本任务只合并 `meta.lyric_maker`，不进入歌词处理链。
- [摄取优先级] -> 自动 `manifest.toml` 是上传素材的一部分，优先于识别出的 staff。-> 前端与 ingest 两端均做署名归一，避免仅依赖浏览器状态。
- [站点构建] -> 执行 `npm run docs:build`。-> 当前独立 worktree 未安装 `vuepress`，命令报 `sh: vuepress: command not found`；专项单元与摄取回归不受影响。
