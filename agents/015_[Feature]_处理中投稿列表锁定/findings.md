# 调研记录

- [现象] 列表已经通过 `/api/ingest/list` 返回 `state`、`stage`、`progress`、`message` 与 `album`，但每项都调用 `pick()`。
- [结论] 活跃作业应继续展示其信息，但不能触发加载编辑路径；以原生禁用按钮承载只读条目，可提供明确的无障碍状态。
