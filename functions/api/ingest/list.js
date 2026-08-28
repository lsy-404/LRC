import { json, passwordOk, bearer, callWorker, cleanRef, REVIEW, listPrefix, readJson } from './_lib.js';

// GET /api/ingest/list — 列出所有待处理草稿，供修改面板直接选择（免记 ref）。
// 每张专辑必有一个 status.json，据此枚举比逐层列目录省一轮往返。
export async function onRequestGet({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const [reviewObjects, webObjects] = await Promise.all([
    listPrefix(env, `${REVIEW}/`),
    listPrefix(env, 'web/'),
  ]);
  const marks = reviewObjects.filter((o) => o.key.endsWith('/status.json'));

  const pending = [];
  const refs = new Set();
  for (const o of marks) {
    const parts = o.key.split('/');
    if (parts.length !== 4) continue;
    const [, ref, album] = parts;
    const st = (await readJson(env, o.key)) || {};
    refs.add(ref);
    pending.push({
      ref,
      album,
      status: st.phase || '',
      state: '',
      stage: '',
      progress: null,
      message: '',
      updated: st.updated || '',
      contributor: st.contributor || '',
      is_update: !!st.is_update,
    });
  }
  const manifests = webObjects.filter((o) => {
    const parts = o.key.split('/');
    return parts.length === 3 && parts[0] === 'web' && parts[2] === 'manifest.json' && cleanRef(parts[1]);
  });
  for (const object of manifests) {
    const [, ref] = object.key.split('/');
    if (refs.has(ref)) continue;
    const manifest = (await readJson(env, object.key)) || {};
    pending.push({
      ref,
      album: manifest.album || '',
      status: 'processing',
      state: '',
      stage: '',
      progress: null,
      message: '',
      updated: manifest.updated || object.uploaded?.toISOString?.() || '',
      contributor: manifest.contributor || '',
      is_update: false,
    });
    refs.add(ref);
  }
  await Promise.all(pending.map(async (item) => {
    const worker = await callWorker(env, `/state?ref=${encodeURIComponent(item.ref)}`, null, 'GET');
    const job = worker.ok && worker.data && worker.data.state !== 'unknown' ? worker.data : null;
    if (!job) return;
    item.state = job.state || '';
    item.stage = job.stage || '';
    item.progress = Number.isFinite(Number(job.progress)) ? Number(job.progress) : null;
    item.message = job.message || '';
    if (!item.status) item.status = job.phase || '';
  }));
  pending.sort((x, y) => (y.updated || '').localeCompare(x.updated || ''));
  return json({ pending });
}
