# 操作记录

- 已读取项目审计索引、任务表及工作站列表/状态实现。
- 已建立独立分支 `codex/processing-list-lock` 与工作树。
- 已修改 `EditBox.vue`：处理中项以禁用按钮呈现阶段、进度、专辑与追踪编号，待审核项仍由可用按钮加载；处理中项不能丢弃。
- 已增加 12 秒列表刷新，确保列表内的处理进度不依赖自动进入编辑加载路径。
- 已运行 `node --experimental-vm-modules --test test/lyric_editor_view.test.mjs test/worker/ingest_panel.test.mjs`，34/34 通过。
- 已运行完整 Node 146/146 与 VuePress 构建；本地浏览器确认处理中项显示 47% 和阶段但按钮禁用，待审核项可打开编辑。
- 统一 Worker 部署成功；线上列表验证失败/处理中条目显示进度与消息且不可打开，待审核条目仍可进入编辑器。
