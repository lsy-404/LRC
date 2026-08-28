# 操作记录

- 2026-08-28：登记失败投稿列表重试入口；确认现有 API、认证与失败锁定规则。
- 2026-08-28：在 `EditBox.vue` 的失败待投稿项加入 `重试` / `重试中…` 控件；请求携带已验证口令，成功后立即刷新列表，失败行内保留 API 的具体错误。
- 2026-08-28：`node --test test/lyric_editor_view.test.mjs test/worker/ingest_panel.test.mjs` 通过，37/37。
- 2026-08-28：尝试 `pnpm run docs:build`，因独立 worktree 缺少 VuePress 依赖未执行到构建阶段；记录后交由主工作区统一构建验证。
- 2026-08-28：已提交独立分支，待主任务拣选并统一部署。
- 2026-08-28：runner 的命令失败异常追加已脱敏的 stderr/stdout 尾部；最多各取 12 行、总计不超过 1200 字符，日志尾部同步脱敏。
- 2026-08-28：`python3 test/runner/test_job_failure_detail.py` 2/2 通过；`python3 -m py_compile runner/jobs.py` 通过。
- 2026-08-28：待投稿元信息加入 ellipsis 裁剪与完整 title；操作区固定为独立上层命中区。窄屏下状态与操作分行，完整错误可换行阅读。
- 2026-08-28：`node --test test/lyric_editor_view.test.mjs` 19/19 通过。
