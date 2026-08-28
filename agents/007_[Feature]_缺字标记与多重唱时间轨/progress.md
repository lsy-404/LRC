# 操作记录

- 2026-08-27：从 `main` 创建独立 worktree 和 `codex/missing-marker-insert` 分支。
- 2026-08-27：读取 `EditBox.vue`、`lrcDraft.js`、`test/lrc_draft.test.mjs` 和 `test/lyric_editor_view.test.mjs`；建立任务审计记录。
- 2026-08-27：添加缺字槽位和单字补标纯函数；时间以相邻 token 或句边界中点插值，且不改动已有 token。
- 2026-08-27：在逐字时间轨前、token 间和末尾渲染可点击缺字槽位，操作接入既有历史记录和播放高亮更新。
- 2026-08-27：运行 `node --test test/lrc_draft.test.mjs test/lyric_editor_view.test.mjs`，33 项通过。
- 2026-08-27：尝试 `pnpm docs:build`；worktree 缺少 `node_modules`，不能解析 VuePress，未执行依赖安装。
