# 调研结论

- [界面范围] -> 贡献指南和工作站都声明 `contribution-workspace`，且指南关闭侧栏和目录 -> 指南恢复普通主题，仅工作站保留特殊外壳。
- [处理中不可见] -> `/api/ingest/list` 只枚举 `review/<ref>/<album>/status.json` -> Phase A 尚未写 review 草稿时无法在修改视图看到任务。
- [发现入口] -> Durable Object 无法枚举，但原始上传始终写 `web/<ref>/manifest.json` -> 用 manifest 发现 ref，再查询权威作业状态。
- [旧任务] -> 原始 manifest 保留约 30 天且完成后写 `.used` -> `.used`、done、unknown 的无 review 项必须过滤，failed 可显示但不能自动载入。
- [自动显示] -> 前端只在已知 ref 时显示进度卡 -> 无当前 ref 时自动载入 queued、dispatching 或 running 的第一项。
