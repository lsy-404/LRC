import {
  json, passwordOk, bearer, ghHeaders, GH_API, REPO,
  REVIEW_BRANCH, cleanRef, b64ToText, encodeContentsPath,
} from './_lib.js';

// GET /api/ingest/state?ref=<sha> — 供修改面板轮询。
// 返回 ingest-review/<ref>/ 下每张专辑的 status + draft（可编辑对象；不含词流 stt）。
// <ref>/ 不存在 → status:'processing'（Phase A 尚未 push，或已被 Phase B 清理）。
export async function onRequestGet({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const ref = cleanRef(url.searchParams.get('ref'));
  if (!ref) return json({ error: 'bad ref' }, 400);

  const gh = (path) => fetch(`${GH_API}${path}`, { headers: ghHeaders(env) });

  const list = await gh(`/repos/${REPO}/contents/${encodeURIComponent(ref)}?ref=${REVIEW_BRANCH}`);
  if (list.status === 404) return json({ ref, status: 'processing', albums: [] });
  if (!list.ok) return json({ error: 'github', step: 'list' }, 502);

  const entries = await list.json().catch(() => null);
  const dirs = Array.isArray(entries) ? entries.filter((e) => e.type === 'dir') : [];

  const readJson = async (relPath) => {
    const r = await gh(`/repos/${REPO}/contents/${encodeContentsPath(relPath)}?ref=${REVIEW_BRANCH}`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data || typeof data.content !== 'string') return null;
    try {
      return JSON.parse(b64ToText(data.content));
    } catch {
      return null;
    }
  };

  const albums = [];
  for (const d of dirs) {
    const [draft, status] = await Promise.all([
      readJson(`${ref}/${d.name}/draft.json`),
      readJson(`${ref}/${d.name}/status.json`),
    ]);
    albums.push({ album: d.name, status: status || {}, draft });
  }
  return json({ ref, status: 'ready', albums });
}
