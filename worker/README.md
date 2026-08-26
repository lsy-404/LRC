# lrc-ingest

站点、工作站 API、摄取与生成编排共用的 Worker。VuePress 构建产物以 Workers
Assets 部署；`/api/upload/*` 与 `/api/ingest/*` 先进入脚本，其余站点文件由资产绑定直出。

## 部署

```
pnpm run docs:build
cd worker
CLOUDFLARE_ACCOUNT_ID=<account> npx wrangler deploy --containers-rollout=immediate
```

会用本机 Docker 构建 `../runner/Dockerfile` 并推到 Cloudflare 镜像仓库。
镜像只含运行时；管道脚本每次作业从仓库稀疏克隆 `.github/`，改脚本无需重建镜像。

## 必需的 Worker 密钥

```
npx wrangler secret put <NAME>
```

| 名称 | 用途 |
| :-- | :-- |
| `UPLOAD_PASSWORD` | 工作站浏览器请求的投稿口令 |
| `INGEST_TOKEN` | 容器访问受保护回调（`/store`、`/state` 等）的令牌 |
| `GH_TOKEN` | PAT，需 contents + pull-requests 写：开 PR、推生成物、触发部署 |
| `GITHUB_WEBHOOK_SECRET` | 仓库 webhook 的 HMAC 密钥 |
| `LLM_API_KEY` / `LLM_API_BASE` / `LLM_MODEL` / `OCR_MODEL` | 管道调用模型 |
| `LYRIC_MAKER` | 歌词制作默认署名，留空则不填 |
| `WORKER_URL` | 本 Worker 的对外地址，容器回打 `/store` 用 |

## 仓库 webhook

Payload URL 指向 `<WORKER_URL>/hooks/github`，content type `application/json`，
密钥填 `GITHUB_WEBHOOK_SECRET`，只订阅 push 事件。

## 自检

```
curl -X POST -H "authorization: Bearer $INGEST_TOKEN" <WORKER_URL>/diag
curl -H "authorization: Bearer $INGEST_TOKEN" "<WORKER_URL>/state?ref=diag"
```

确认容器起得来、外部命令齐、对象存储往返通。
