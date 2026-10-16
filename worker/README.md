# lrc-ingest

站点、歌词工作站 API、摄取与生成编排共用的 Worker。VuePress 构建产物以 Workers
Assets 部署；`/api/{upload,ingest,workspace,auth,library}/*` 先进入脚本，其余站点文件由资产绑定直出。

歌词工作站（`/studio/`）由私有方案包 `@platform-kit/solution-studio` 构建：本仓库只保留宿主入口
`studio/`、Worker 接线 `src/studio.js` 与路由授权表 `src/api.js`。登录走统一身份
（`id.voidcarve.com`），曲库与权限来自 EdgeSonic 的 `StudioGateway` 服务绑定。

## 部署

先把私有包放到 `vendor/`（CI 用 `PLATFORM_KIT_TOKEN` 从 `lsy-404/platform-kit-internal` 的 Release 下载并校验摘要）：

```
pnpm install --frozen-lockfile
corepack pnpm@10.34.6 --dir worker install --frozen-lockfile
pnpm run docs:build
pnpm run studio:install && pnpm run studio:build
cd worker
CLOUDFLARE_ACCOUNT_ID=<account> corepack pnpm@10.34.6 exec wrangler deploy --containers-rollout=immediate
```

EdgeSonic 必须先部署包含 `StudioGateway` 的版本，且启用统一身份（`SSO_ISSUER`、`SSO_SHARED_IDENTITY_MAPPING=1`）。
`wrangler.jsonc` 的 `services` 绑定按 Worker 名 `edgesonic` 查找入口。

会用本机 Docker 构建 `../runner/Dockerfile` 并推到 Cloudflare 镜像仓库。
镜像只含运行时；管道脚本每次作业从仓库稀疏克隆 `.github/`，改脚本无需重建镜像。

## 必需的 Worker 密钥

```
corepack pnpm@10.34.6 --dir worker exec wrangler secret put <NAME>
```

| 名称 | 用途 |
| :-- | :-- |
| `SSO_CLIENT_SECRET` | 统一身份客户端 `lrc-studio` 的密钥（至少 32 字符） |
| `STUDIO_COOKIE_SECRET` | 封装授权事务 Cookie 的随机密钥（至少 32 字节，如 `openssl rand -base64 32`） |
| `INGEST_TOKEN` | 容器访问受保护回调（`/store`、`/state` 等）的令牌 |
| `GH_TOKEN` | PAT，需 contents + pull-requests 写：开 PR、推生成物、触发部署 |
| `GITHUB_WEBHOOK_SECRET` | 仓库 webhook 的 HMAC 密钥 |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | 可选：工作站账号绑定 GitHub 用于署名 |
| `LLM_API_KEY` / `LLM_API_BASE` / `LLM_MODEL` / `OCR_MODEL` | 管道调用模型 |
| `LYRIC_MAKER` | 歌词制作默认署名，留空则不填 |
| `WORKER_URL` | 本 Worker 的对外地址，容器回打 `/store` 用 |

`SSO_ISSUER`、`SSO_CLIENT_ID`、`SSO_PROVIDER_NAME`、`LIBRARY_UPLOAD_ROOT` 在 `wrangler.jsonc` 的 `vars` 中。

## 统一身份客户端

在 personal-sso 的 `OIDC_CLIENTS` 中追加（保留已有条目），并把 `client_secret` 同时设为本 Worker 的 `SSO_CLIENT_SECRET`：

```json
{
  "client_id": "lrc-studio",
  "client_name": "LRC 工作站",
  "client_secret": "<至少 32 字符>",
  "token_endpoint_auth_method": "client_secret_basic",
  "redirect_uris": ["https://lrc.voidcarve.com/api/auth/sso/callback"],
  "post_logout_redirect_uris": ["https://lrc.voidcarve.com/studio/"],
  "backchannel_logout_uri": "https://lrc.voidcarve.com/api/auth/sso/backchannel-logout",
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "scope": "openid profile email",
  "require_signed_request_object": false,
  "client_uri": "https://lrc.voidcarve.com/studio/"
}
```

再在身份服务的管理页为 `lrc-studio` 设置应用访问策略。首次登录时，若 `preferred_username` 与旧工作站账号同名，
该账号会被关联到统一身份；否则新建编辑者账号。

## 权限

每条 API 路由在 `src/api.js` 声明所需动作；动作由当前用户在 EdgeSonic 中的权限决定，判定结果缓存 30 秒。
曲库音频上传进 EdgeSonic 的 `LRC/<专辑名>/`，入库时按清单中的提交者身份经 `/store` 从曲库流式取料，不在 R2 留副本。

## 仓库 webhook

Payload URL 指向 `<WORKER_URL>/hooks/github`，content type `application/json`，
密钥填 `GITHUB_WEBHOOK_SECRET`，只订阅 push 事件。

## 自检

```
curl -X POST -H "authorization: Bearer $INGEST_TOKEN" <WORKER_URL>/diag
curl -H "authorization: Bearer $INGEST_TOKEN" "<WORKER_URL>/state?ref=diag"
```

确认容器起得来、外部命令齐、对象存储往返通。
