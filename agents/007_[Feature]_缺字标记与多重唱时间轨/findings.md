# 调研记录

- [现状] -> `parseKaraokeRows` 可产生少于正文字符数量的 token；展示层只遍历 `row.words`，缺字没有可点击入口。 -> 需要按正文与现有 token 的 LCS 对齐，找出未覆盖字符位置。
- [现状] -> `reconcileWordCharacters` 已用相邻匹配 token 插值，但会重建整个序列。 -> 新函数必须只在缺口插入 token，保留已有 token 对象、`_id` 和时间。
- [现状] -> `setWordTime` 已负责锁定时间轴、刷新播放高亮和提交历史。 -> 插入操作沿用相同副作用。
- [验证] -> `node --test test/lrc_draft.test.mjs test/lyric_editor_view.test.mjs`。 -> 33 项通过。
- [构建] -> worktree 没有本地依赖；复用主 worktree 的 CLI 后，Node 仍无法从当前 worktree 的配置解析 `vuepress` 包。 -> 构建验证受依赖链接缺失阻断，未安装或改写依赖。
