# LRC 项目索引
> 最后更新：2026-08-30

## 项目目标
VuePress LRC 专辑站与投稿工作站，为歌词、音频、图片资料提供上传、校正和摄取流程。

## 技术栈
Vue 3、VuePress 2、Vite；工作站组件位于 `docs/.vuepress/components`。

## 模块结构
- `Workbench.vue`：工作站验证、上传/修改页签。
- `UploadBox.vue`：文件选择、图片关联、上传清单和预览。
- `EditBox.vue`：投稿草稿编辑、封面保存和歌词校正。
- `functions/api/ingest/cover.js`：已有封面字节保存接口。

## 任务审计
本任务记录见 `agents/001_[Feature]_图片马赛克与共享关联/`。
