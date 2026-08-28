# 调研结论

## 初始检查

- `worker/wrangler.jsonc` 当前 Container 为 `standard-2`、`max_instances: 5`。
- Phase A 当前单专辑内音频 STT 使用 4 路线程；每路先运行 ffprobe/ffmpeg，再发起转写请求。
- OCR 当前使用 6 路线程；PDF 扫描页回退 OCR 为串行，但可能与图片 OCR 共享同一进程。
- `runner/server.py` 使用 `ThreadingHTTPServer`，可为每个 `/run` 启动后台线程，没有作业内存上限。

## 方案

基础规格是 1/4 vCPU、1 GiB、4 GB。采用最简单的进程内护栏：单容器同时只执行一个作业，Phase A STT/OCR 均串行。这样不改 LRC 权威源、review 闸门或 Phase B 边界；只是把峰值从“容器作业数 × 4/6 路”压到单路。FFmpeg 作为 STT 单路前置步骤自然不重叠。

## 验证

- `test/runner/test_container_memory_guard.py`：3 个专项断言通过。
- 系统 `python3 -m pytest`：失败，环境没有安装 pytest；不是代码失败。
- Wrangler dry-run 首次因缺少 `worker/node_modules` 失败，`npm ci --ignore-scripts` 后重跑通过；生成的 dist 临时目录已清理，未部署。
- 0.25 vCPU 下串行会增加墙钟时间；当前没有生产基准日志可严格证明所有大投稿低于 1 小时，需用代表性大投稿做一次计时验收。内存安全优先于未经测量的时间承诺。
