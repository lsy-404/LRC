# lrc-ingest

摄取与生成的编排 Worker。站点仍在 Pages，但 Pages Functions 绑不了容器，
所以编排单独成一个 Worker，Pages 侧凭 `INGEST_TOKEN` 调它。

## 部署

```
CLOUDFLARE_ACCOUNT_ID=<account> npx wrangler deploy
```

会用本机 Docker 构建 `../runner/Dockerfile` 并推到 Cloudflare 镜像仓库。
镜像只含运行时；管道脚本每次作业从仓库稀疏克隆 `.github/`，改脚本无需重建镜像。

## 必需的 Worker 密钥

```
npx wrangler secret put <NAME>
```

| 名称 | 用途 |
| :-- | :-- |
| `INGEST_TOKEN` | Pages Functions 与容器访问本 Worker 的令牌，三处必须一致 |
| `GH_TOKEN` | PAT，需 contents + pull-requests 写：开 PR、推生成物、触发部署 |
| `GITHUB_WEBHOOK_SECRET` | 仓库 webhook 的 HMAC 密钥 |
| `LLM_API_KEY` / `LLM_API_BASE` / `LLM_MODEL` / `OCR_MODEL` | 管道调用模型 |
| `LYRIC_MAKER` | 歌词制作默认署名，留空则不填 |
| `WORKER_URL` | 本 Worker 的对外地址，容器回打 `/store` 用 |

## Pages 侧需要的变量

`INGEST_WORKER_URL`（本 Worker 地址）与 `INGEST_TOKEN`，生产与预览环境都要配。

## 仓库 webhook

Payload URL 指向 `<WORKER_URL>/hooks/github`，content type `application/json`，
密钥填 `GITHUB_WEBHOOK_SECRET`，只订阅 push 事件。

## 自检

```
curl -X POST -H "authorization: Bearer $INGEST_TOKEN" <WORKER_URL>/diag
curl -H "authorization: Bearer $INGEST_TOKEN" "<WORKER_URL>/state?ref=diag"
```

确认容器起得来、外部命令齐、对象存储往返通。
