# 操作记录

- 已读取工作台状态接口、`EditBox.vue` 的草稿转换逻辑和 `lrcDraft.js` 的解析逻辑。
- 已确认状态接口会原样返回 `draft`，问题位于前端行模型构建而非接口截断。
- 已在 `lrcDraft.js` 增加结构化行解析：支持数值毫秒和 `mm:ss.xxx` 字符串，仅在 LRC/KLRC 没有可解析行时使用。
- 已在 `test/lrc_draft.test.mjs` 加入结构化行恢复及 LRC 优先级回归用例。
- 已执行 `node --test test/lrc_draft.test.mjs`：36 项通过、0 项失败；Node 报告现有无 `type: module` 的性能提示，未影响结果。
- 已执行变更范围与空白检查；本次工作区仅有解析器、对应测试和任务索引的改动。
- 首次交付暂存被 `.gitignore` 拦截，尚未创建提交；将使用限定路径的强制暂存后重试。
