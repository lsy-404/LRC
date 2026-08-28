# 调研结论

- `POST /api/ingest/retry` 已要求 Bearer 口令，并只按 ref 重新排队，不重新上传原料。
- 待投稿列表已能识别 `state/status === failed`，但此前只在手工载入该 ref 后显示重试操作，列表中没有直接入口。
- `pnpm run docs:build` 在独立 worktree 未能运行：本地未安装 `vuepress` 依赖；复用主工作区二进制时模块解析仍从独立 worktree 查找包。专项 Node 回归可正常运行。
- runner 的 `run()` 已写入输出尾部日志，但异常只包含已展示命令，Worker 只会拿到这条过于笼统的异常文本。
- 初版截断标记会令错误详情比上限多一个字符；改为在保留标记时从尾部少取一个字符。
- 失败状态文字使用 `nowrap` 却未设置溢出裁剪，禁用的待投稿打开按钮会把可点击区域覆盖到相邻的重试按钮。
- “三无”失败由 11 个 FLAC 内容但 `.mp3` 扩展名的文件触发；Mutagen 按扩展名走 MP3 解析而报 MPEG frame header 错误。
