# 操作记录

- 已建立任务目录并记录初始并发与 Container 配置。
- 修改 `worker/wrangler.jsonc`：Container `instance_type` 降为 `basic`，保留 `max_instances: 5`（实例数不等于单实例并发，避免改变调度容量）。
- 修改 `runner/server.py`：增加进程内单作业信号量，多个请求仍快速返回并排队，但不会同时运行管道。
- 修改 `.github/scripts/ingest/pipeline.py` 与 `ocr.py`：Phase A STT/OCR 线程池均固定为 1。
- 新增 `test/runner/test_container_memory_guard.py`：覆盖规格、两处线程池和 Runner 单作业峰值。
- 专项测试三个断言已通过；`pytest` 不可用（系统 Python 未安装 pytest），已记录。
- `node --test test/worker/*.test.mjs`：39 通过、5 失败；失败均为既有 Node 环境不支持 `vm.SyntheticModule` 的测试加载问题，未涉及本次改动。
- `npx wrangler deploy --dry-run`：安装 Worker 依赖后通过，完成 Worker bundle 与 Container image build；仅有 Docker `FROM --platform` 警告。
- 主线改用 `--experimental-vm-modules` 完整验证后 Worker 测试 91/91 通过；内存护栏测试改用 `unittest` 后 3/3 通过。
- 已部署生产；Container v13 的实际配置为 0.25 vCPU、1 GiB 内存和 4 GB 磁盘，全部调度槽健康。
