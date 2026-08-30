# 发现

- [解析缺口] -> `parseVocalDrafts` 仅调用 `parseLrc` 与 `parseKaraokeRows` -> 草稿 `lines` 中的 `{ text, time }` 无法构成编辑器行，时间戳不会进入工作台。
- [数据权威] -> 上传的 LRC 文本、时间戳和顺序保持优先 -> 结构化行仅作为无可解析 LRC 行时的读取来源。
- [交付命令] -> 常规 `git add` 被仓库的忽略规则拦截 -> `agents` 和 `test` 均为受控任务文件，需在仅列出本次路径的前提下使用强制暂存。
