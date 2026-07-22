import { json, passwordOk, bearer, ghHeaders, GH_API, REPO } from './_lib.js';

// 透传：客户端直接发 GitHub create-blob 的 JSON（base64 在浏览器端已编好），
// 此处只验密码、换上 PAT 头转发。blob 无引用，不触发任何 workflow。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const resp = await fetch(`${GH_API}/repos/${REPO}/git/blobs`, {
    method: 'POST',
    headers: ghHeaders(env, { 'content-type': 'application/json' }),
    body: request.body,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return json({ error: 'github', status: resp.status, message: data.message }, 502);
  return json({ sha: data.sha });
}
