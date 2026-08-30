# 调研与发现

- 工作站上传图片由 `UploadBox.vue` 管理；图片在预览层通过 `previewItem` 打开，旋转会替换 `it.file`，上传使用当前 `it.file`。
- 现有图片关联支持每张歌词本图片绑定一个曲目 uid 或 `SP`，manifest 以 `[链接]` 写出；本任务不改后端契约。
- `functions/api/ingest/cover.js` 是修改面板已有的封面保存接口；上传工作站自身直接提交 R2 文件，处理后图片应替换同一 `it.file`。
- 构建验证：首次运行因独立 worktree 缺少依赖失败；执行 `pnpm install --frozen-lockfile` 后，`pnpm docs:build` 成功完成 904 页面渲染。

## 失败/调试记录

- 初始仓库无 `/agents`，已按规范初始化。
