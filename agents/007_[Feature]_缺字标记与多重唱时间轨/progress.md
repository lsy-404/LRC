# 操作记录

- 2026-08-27：从 `main` 创建独立 worktree 和 `codex/missing-marker-insert` 分支。
- 2026-08-27：读取 `EditBox.vue`、`lrcDraft.js`、`test/lrc_draft.test.mjs` 和 `test/lyric_editor_view.test.mjs`；建立任务审计记录。
- 2026-08-27：添加缺字槽位和单字补标纯函数；时间以相邻 token 或句边界中点插值，且不改动已有 token。
- 2026-08-27：在逐字时间轨前、token 间和末尾渲染可点击缺字槽位，操作接入既有历史记录和播放高亮更新。
- 2026-08-27：运行 `node --test test/lrc_draft.test.mjs test/lyric_editor_view.test.mjs`，33 项通过。
- 2026-08-27：尝试 `pnpm docs:build`；worktree 缺少 `node_modules`，不能解析 VuePress，未执行依赖安装。
- 2026-08-27：读取 agent-mode 工作流、项目索引与任务清单；在独立 worktree 创建任务审计文件并完成现有格式/编辑器审计。
- 2026-08-27：新增 `vocals[]` 草稿声部流，主声部继续使用既有顶层 LRC/KLRC；编辑器支持声部切换、新增与共享播放头下的重叠高亮。
- 2026-08-27：`node --test test/lrc_draft.test.mjs test/lyric_editor_view.test.mjs` 通过（32 项）。`pnpm docs:build` 因 worktree 缺少 `node_modules` 而未执行。
- 2026-08-27：提交 `09b35de`（`feat: support parallel vocal lyric parts`），未部署、未推送。
- 2026-08-27：完成动态轨道宽度、前后留白和 5 ms/px 精细拖动，聚焦测试 35 项通过。
- 2026-08-27：开始主线整合，并补充多声部最终写盘与缺字边界验收。
