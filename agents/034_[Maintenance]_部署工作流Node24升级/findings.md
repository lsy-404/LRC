# Findings

- 最新部署运行成功，所有步骤结论均为 success。
- 汇总标注来自 `pnpm/action-setup@v4` 与 `cloudflare/wrangler-action@v3.14.1` 声明的 Node 20 运行时，不是构建或部署错误。
- 上游正式发行版 `pnpm/action-setup@v6.0.10` 与 `cloudflare/wrangler-action@v4.0.0` 均声明使用 Node 24。
- Wrangler Action v4 默认使用 Wrangler v4；项目 Worker 已安装 Wrangler v4，因此无需保留 v3 行为。
