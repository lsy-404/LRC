# 调研结论

- 列表接口从 `review/<ref>/<album>/status.json` 的路径直接取 `album`，没有读取同目录 `draft.json` 中已编辑的专辑名称，因此刷新后显示旧名。
- 状态接口把 R2 目录名作为 `album` 返回，前端据此初始化 `_storageAlbum`；显示名称仅存在于草稿对象中，没有独立接口字段。
- 页面上方待处理列表只渲染 `pending.album`，当前编辑框的 `e.album` 变化不会即时反映到列表。
- 丢弃和封面接口仍应使用不可变 R2 目录名；显示名称不得改变 bundle 定位。
