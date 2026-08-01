import { json, passwordOk, bearer, REVIEW, listPrefix, readJson } from './_lib.js';

// GET /api/ingest/list — 列出所有待处理草稿，供修改面板直接选择（免记 ref）。
// 每张专辑必有一个 status.json，据此枚举比逐层列目录省一轮往返。
export async function onRequestGet({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const objects = await listPrefix(env, `${REVIEW}/`);
  const marks = objects.filter((o) => o.key.endsWith('/status.json'));

  const pending = [];
  for (const o of marks) {
    const parts = o.key.split('/');
    if (parts.length !== 4) continue;
    const [, ref, album] = parts;
    const st = (await readJson(env, o.key)) || {};
    pending.push({
      ref,
      album,
      status: st.phase || '',
      updated: st.updated || '',
      contributor: st.contributor || '',
      is_update: !!st.is_update,
    });
  }
  pending.sort((x, y) => (y.updated || '').localeCompare(x.updated || ''));
  return json({ pending });
}
