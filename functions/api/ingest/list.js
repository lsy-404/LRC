import {
  json, passwordOk, bearer, ghHeaders, GH_API, REPO,
  REVIEW_BRANCH, b64ToText, encodeContentsPath,
} from './_lib.js';

// GET /api/ingest/list — 列出所有 pending review bundle，供修改面板直接选择（免记 ref）。
// 遍历 ingest-review 分支根的 <ref> 目录 → 各 <ref>/<album>/status.json 取状态。
export async function onRequestGet({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);

  const gh = (path) => fetch(`${GH_API}${path}`, { headers: ghHeaders(env) });

  const root = await gh(`/repos/${REPO}/contents?ref=${REVIEW_BRANCH}`);
  if (root.status === 404) return json({ pending: [] }); // 分支不存在或空
  if (!root.ok) return json({ error: 'github', step: 'root' }, 502);

  const entries = await root.json().catch(() => null);
  const refDirs = Array.isArray(entries)
    ? entries.filter((e) => e.type === 'dir' && /^[0-9a-f]{7,40}$/.test(e.name))
    : [];

  const readJson = async (relPath) => {
    const r = await gh(`/repos/${REPO}/contents/${encodeContentsPath(relPath)}?ref=${REVIEW_BRANCH}`);
    if (!r.ok) return null;
    const data = await r.json().catch(() => null);
    if (!data || typeof data.content !== 'string') return null;
    try { return JSON.parse(b64ToText(data.content)); } catch { return null; }
  };

  const pending = [];
  for (const d of refDirs) {
    const sub = await gh(`/repos/${REPO}/contents/${encodeURIComponent(d.name)}?ref=${REVIEW_BRANCH}`);
    if (!sub.ok) continue;
    const albums = await sub.json().catch(() => []);
    for (const a of (Array.isArray(albums) ? albums : [])) {
      if (a.type !== 'dir') continue;
      const st = await readJson(`${d.name}/${a.name}/status.json`);
      pending.push({
        ref: d.name,
        album: a.name,
        status: (st && st.phase) || '',
        updated: (st && st.updated) || '',
        contributor: (st && st.contributor) || '',
        is_update: !!(st && st.is_update),
      });
    }
  }
  pending.sort((x, y) => (y.updated || '').localeCompare(x.updated || ''));
  return json({ pending });
}
