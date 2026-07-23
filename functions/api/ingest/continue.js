import { json, passwordOk, bearer, ghHeaders, GH_API, REPO, cleanRef } from './_lib.js';

// POST /api/ingest/continue { ref } — 人工在修改面板确认（或一键放行）后触发 Phase B。
// 发 repository_dispatch(ingest-continue) 给 ingest_finalize.yml。
// 用 env.GH_TOKEN（PAT）：PAT 发起的 dispatch 能触发 workflow（GITHUB_TOKEN 不能）。
// finalize 幂等：bundle 已被处理/清理时其 guard 会跳过，故重复触发安全。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  if (!ref) return json({ error: 'bad ref' }, 400);

  const resp = await fetch(`${GH_API}/repos/${REPO}/dispatches`, {
    method: 'POST',
    headers: ghHeaders(env, { 'content-type': 'application/json' }),
    body: JSON.stringify({ event_type: 'ingest-continue', client_payload: { ref } }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    return json({ error: 'github', status: resp.status, message: data.message }, 502);
  }
  // dispatches 成功返回 204 无正文
  return json({ ok: true, ref });
}
