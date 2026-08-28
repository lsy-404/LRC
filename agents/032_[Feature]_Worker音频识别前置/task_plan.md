# Worker 音频识别前置

- [x] 核对 OpenAI 音频接口与 Workers/R2 的最新限制。
- [x] 选择可支持大音频的 Worker→OpenAI 传输方式。
- [x] 在 Durable Object 中持久化并驱动逐音频识别状态。
- [x] 将识别结果写入审核原料并改造 Runner 消费结果。
- [x] 将 Container 调整为 lite，并保留启动前全量就绪闸门。
- [x] 添加覆盖前置状态与 Runner 消费路径的专项测试。
- [x] 执行专项测试与提交；dry-run 受 worktree 缺少 Worker 依赖阻断。
