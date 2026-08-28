# 调研结论

- `POST /api/ingest/retry` 已要求 Bearer 口令，并只按 ref 重新排队，不重新上传原料。
- 待投稿列表已能识别 `state/status === failed`，但此前只在手工载入该 ref 后显示重试操作，列表中没有直接入口。
- `pnpm run docs:build` 在独立 worktree 未能运行：本地未安装 `vuepress` 依赖；复用主工作区二进制时模块解析仍从独立 worktree 查找包。专项 Node 回归可正常运行。
- runner 的 `run()` 已写入输出尾部日志，但异常只包含已展示命令，Worker 只会拿到这条过于笼统的异常文本。
- 初版截断标记会令错误详情比上限多一个字符；改为在保留标记时从尾部少取一个字符。
