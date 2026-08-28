# 调研结论

- `sleepAfter` 由入站 Container 请求续期；运行中作业每十秒一次 `/status` 请求，因此不能依赖空闲休眠来收口作业。
- DO 的一小时超时此前只改变持久化状态，Runner 的后台线程及其子进程没有终止边界。
- 采用 55 分钟单命令超时，给一小时 DO 总预算保留五分钟收口时间；超时错误携带经脱敏截断的 stdout/stderr 尾部。
- 终态先写入 DO storage，再 best-effort 调用对应实例的 `stop()`；停止异常只进入 Worker 日志，不覆盖成功、失败或取消状态。
