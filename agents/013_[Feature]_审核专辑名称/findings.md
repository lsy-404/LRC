# 调研结论

- [根因] -> EditBox 将 `e.album` 同时用作显示名和 `review/<ref>/<album>` 的 R2 路径参数；直接让它可编辑会使后续保存、封面与丢弃指向不存在的 bundle。
- [解决] -> 保留不可变 `_storageAlbum` 仅用于 review/R2 定位；`album` 仅写入 draft，Phase B 读取 draft 后决定最终输出目录。
- [安全] -> 即使 API 外部直接写入草稿，`organize.finalize` 仍把专辑名压为单个安全 basename，阻止路径片段进入 `res`。
