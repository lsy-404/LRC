# 操作记录

- 已读取项目审计索引、任务表及工作站列表/状态实现。
- 已建立独立分支 `codex/processing-list-lock` 与工作树。
- 已修改 `EditBox.vue`：处理中项以禁用按钮呈现阶段、进度、专辑与追踪编号，待审核项仍由可用按钮加载；处理中项不能丢弃。
- 已增加 12 秒列表刷新，确保列表内的处理进度不依赖自动进入编辑加载路径。
- 已运行 `node --experimental-vm-modules --test test/lyric_editor_view.test.mjs test/worker/ingest_panel.test.mjs`，34/34 通过。
