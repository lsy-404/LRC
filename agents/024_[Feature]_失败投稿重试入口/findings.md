# 调研结论

- `POST /api/ingest/retry` 已要求 Bearer 口令，并只按 ref 重新排队，不重新上传原料。
- 待投稿列表已能识别 `state/status === failed`，但此前只在手工载入该 ref 后显示重试操作，列表中没有直接入口。
- `pnpm run docs:build` 在独立 worktree 未能运行：本地未安装 `vuepress` 依赖；复用主工作区二进制时模块解析仍从独立 worktree 查找包。专项 Node 回归可正常运行。
