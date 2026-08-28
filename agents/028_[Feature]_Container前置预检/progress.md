# 操作记录

- 已建立独立 worktree `LRC-worker-preflight` 和分支 `codex/worker-preflight`。
- 已阅读 `worker/src/job.js`、上传 finalize 端点与现有 Worker 测试。
- 已在 `#dispatchQueued()` 的 Phase A 分支加入 R2 manifest/object 预检；失败路径调用终态失败记录，未调用 Runner。
- 已执行 `node --experimental-vm-modules --test test/worker/orchestrator_job.test.mjs`：6/6 通过。
- 已执行 `node --experimental-vm-modules --test test/worker/*.test.mjs`：46/46 通过；仅有仓库既有 package module type 提示。
- 已执行 diff 空白检查；审计目录被全局忽略规则覆盖，提交时需要显式强制纳入。
- 已创建独立提交 `3817f27`；随后发现全局忽略规则也覆盖 `/test`，将把该测试显式纳入同一提交。
- 已加入 1.25 GiB 投稿总大小上限和可操作的拆分专辑提示。
- 已重新执行作业测试：7/7 通过；独立提交已更新为 `6ade7a1`。
