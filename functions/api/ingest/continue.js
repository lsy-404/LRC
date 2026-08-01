import { json, passwordOk, bearer, callWorker, cleanRef } from './_lib.js';

// POST /api/ingest/continue { ref } — 人工确认（或一键放行）后转交编排 Worker 跑 Phase B。
// 编排侧幂等：草稿已被消费或丢弃时直接返回，重复触发安全。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  if (!ref) return json({ error: 'bad ref' }, 400);

  const started = await callWorker(env, '/finalize', { ref });
  if (!started.ok) {
    return json({ error: 'ingest', status: started.status, message: started.data?.error }, 502);
  }
  return json({ ok: true, ref, ...started.data });
}
