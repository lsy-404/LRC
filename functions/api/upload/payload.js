import { json, bearer, ingestOk, cleanSession, cleanIndex } from './_lib.js';

// CI 取料端点。R2 绑定只存在于 Cloudflare 运行时内，GitHub runner 不在其中，
// 早先因此要在 CI 里长期存放能直读整桶的 S3 密钥；改由本函数代读代写后，CI 只
// 需一个 INGEST_TOKEN，权限收窄到「按 session 取自己那批原料 + 打一个标记」。
//   GET ?session=&n=  → 流式返回原料 web/<session>/<n>
//   PUT ?session=     → 写 web/<session>/.used 标记（请求体为 JSON）
const MAX_MARK_BYTES = 4096;

function params(request) {
  const url = new URL(request.url);
  return {
    session: cleanSession(url.searchParams.get('session')),
    n: cleanIndex(url.searchParams.get('n')),
  };
}

export async function onRequestGet({ request, env }) {
  if (!(await ingestOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const { session, n } = params(request);
  if (!session || n === null) return json({ error: 'bad request' }, 400);

  const obj = await env.UPLOAD_BUCKET.get(`web/${session}/${n}`);
  if (!obj) return json({ error: 'not found' }, 404);

  // 流式转发，不在函数内缓冲——原料单文件可达 95MB
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(obj.size),
      etag: obj.httpEtag,
    },
  });
}

export async function onRequestPut({ request, env }) {
  if (!(await ingestOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const { session } = params(request);
  if (!session) return json({ error: 'bad request' }, 400);

  const mark = await request.text();
  if (!mark || mark.length > MAX_MARK_BYTES) return json({ error: 'bad mark' }, 400);

  await env.UPLOAD_BUCKET.put(`web/${session}/.used`, mark, {
    httpMetadata: { contentType: 'application/json' },
  });
  return json({ ok: true });
}
