# Container 前置预检计划

- [x] 读取 Worker/DO 调度与上传 manifest 写入路径。
- [x] 在 Phase A 的唯一 Container 派发点前校验 manifest 与 R2 原料对象。
- [x] 为成功、缺失和大小不符场景添加根目录测试。
- [x] 依据基础磁盘余量限制投稿总大小并覆盖拒绝路径。
- [x] 记录结果并提交独立分支。
