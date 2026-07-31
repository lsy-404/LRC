import { json, passwordOk, bearer } from './_lib.js';

// R2 直传：浏览器把文件原始二进制流式写入 R2，绕开旧 base64→GitHub create-blob
// 通道的两层天花板（create-blob 实测 ~40MiB 解码上限即 502；base64 膨胀 4/3 使
// 95MB 文件的请求体超过 Cloudflare 100MB 入站上限）。
// 对象 key 固定为 web/<session>/<n>（全 ASCII），中文相对路径只记在 finalize
// 提交的 .r2-payload.json 清单里，workflow 取料时按清单落地重建目录结构。
const MAX_BYTES = 100 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const url = new URL(request.url);
  const session = url.searchParams.get('session') || '';
  const n = Number(url.searchParams.get('n'));
  if (!/^[0-9a-f]{16,64}$/.test(session) || !Number.isInteger(n) || n < 0 || n >= 500) {
    return json({ error: 'bad request' }, 400);
  }
  const len = Number(request.headers.get('content-length'));
  if (!Number.isInteger(len) || len <= 0 || len > MAX_BYTES) {
    return json({ error: 'bad length' }, 400);
  }

  const obj = await env.UPLOAD_BUCKET.put(`web/${session}/${n}`, request.body);
  return json({ ok: true, size: obj.size });
}
