# 调查记录

- [现状] -> `editTimelineChar` 取输入文本的最后一个字符。 -> 粘贴或输入多个字会丢失前面的字符。
- [语义] -> 非空替换应保留 token 的 `_id` 与时间并同步正文；清空标记应移除 token 而保留 `row.text`，使所有原字符重新成为缺字槽位。
- [边界] -> 多字 token 继续由现有 `splitTimedToken` 按 `charIndex` 拆分，不需要改变右键菜单行为。
- [回归] -> 既有视图测试断言旧的逐字符文本重建实现。 -> 更新为校验新的纯函数结果回写，保留同一行为约束。
- [验证] -> `node --test test/lrc_draft.test.mjs test/lyric_editor_view.test.mjs`。 -> 41 项通过。
- [交互] -> 原可编辑节点位于每个字符。 -> 上提到时间标记单元，输入和粘贴替换整枚 token，右键子字符仍携带 `charIndex` 供内部拆分。
