# 执行记录

- 已建立独立 worktree `codex/lrc-authority`，基于当前 main 审计上传与审核链路。
- `pipeline.classify()` 已将 `.lrc` 单列为权威输入，并按同名音频绑定逐字对齐来源。
- 新增 `ingest/authority_lrc.py`：保存原始 LRC 文本，逐字侧车仅在源行边界内写入时间标签。
- `organize`、Phase A/Phase B 与工作台保存均对 `authoritative_lrc` 原样透传；自动简繁/水印/空歌词路径不会触及其标准 LRC。
- 验证：`python3 test/ingest/test_authoritative_lrc.py`、`python3 test/ingest/test_chinese_simplified.py`、`python3 test/ingest/test_stt_watermark_filter.py`、`node --test test/lrc_draft.test.mjs test/authoritative_lrc_workbench.test.mjs` 全部通过。
- 权威 LRC 工作台已改为歌词编辑全锁定：文本、行时间、增删拆合、合音、逐字输入与拖动、撤回/恢复均不可操作；播放、试听、曲名、序号、输出名、最终文件名、伴奏标记和专辑元数据继续可编辑。
- 完整 Node 165/165、权威 LRC Python 专项、VuePress 898 页构建与统一 Worker 部署通过；现有生产草稿均未携带权威 LRC，未制造额外投稿仅作验收。
