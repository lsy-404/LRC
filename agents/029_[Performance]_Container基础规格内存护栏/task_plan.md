# Container 基础规格内存护栏

- [x] 量化现有 Phase A 并发与容器规格，确定最小安全护栏
- [x] 收紧容器内作业、STT/FFmpeg 与 OCR 并发
- [x] 添加根 `/test` 回归，覆盖内存护栏和业务边界不变
- [x] 运行专项测试与 `wrangler deploy --dry-run`
- [x] 记录证据并提交分支
