# 操作记录

- 2026-08-28：从 `main` 创建独立分支 `codex/vocal-color-ui`，确认 `723f776` 已在当前 `main` 历史中。
- 2026-08-28：审查 `EditBox.vue` 和 `lrcDraft.js` 的现有草稿实现并建立本任务审计记录。
- 2026-08-28：以一个 `eb-editor-panel` 连续渲染主唱和声；行编辑、逐字拖动、切分、合并、插入、删除均直接作用对应歌词流。
- 2026-08-28：规范遗留 `harmony` 数据保存名为“和声”，移除用户界面中的“合音”和泛化声部选择。
- 2026-08-28：保留每条和声的唯一稳定 id，避免多重唱产生重复 Vue key；显示/保存名称仍统一为“和声”。
- 2026-08-28：`node --test test/lyric_editor_view.test.mjs test/lrc_draft.test.mjs test/authoritative_lrc_workbench.test.mjs test/harmony_workbench_ui.test.mjs` 55/55 通过；`npm run docs:build` 成功渲染 898 页。
