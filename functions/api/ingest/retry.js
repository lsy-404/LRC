import { json, requireUser, callWorker, cleanRef } from './_lib.js';

// POST /api/ingest/retry { ref } — Phase A 失败后用原始 manifest 重新排队，不重传原料。
export async function onRequestPost({ request, env }) {
  if (!(await requireUser({ request, env }))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  if (!ref) return json({ error: 'bad ref' }, 400);

  const started = await callWorker(env, '/ingest', { ref });
  if (!started.ok) {
    return json({ error: 'ingest', status: started.status, message: started.data?.error }, 502);
  }
  if (!started.data?.ok) {
    return json({ error: started.data?.reason || 'cannot retry', phase: started.data?.phase }, 409);
  }
  return json({ ok: true, ref, ...started.data });
}
