# 调研结论

- [现状] -> EditBox 以 `toEdit` 读取轨字段、`toDraft` 透传回草稿；歌词历史快照只包含标题、伴奏标记和歌词内容 -> 新文件名字段必须同时进入这三处。
- [写盘] -> `organize.finalize` 目前固定拼接 `序号 曲名` -> 用户输入应在此处转为无扩展名 basename，再分别追加 `.lrc` 和 `.klrc`。
- [测试环境] -> 系统只有 `python3` 且没有 pytest -> 使用 `runpy` 直接执行相同 Python 测试函数，覆盖真实 `finalize` 写盘结果。
