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
  const reviewItems = await Promise.all(marks.map(async (o) => {
    const parts = o.key.split('/');
    if (parts.length !== 4) return null;
    const [, ref, album] = parts;
    const [st, draft] = await Promise.all([
      readJson(env, o.key),
      readJson(env, `${REVIEW}/${ref}/${album}/draft.json`),
    ]);
    return {
      ref,
      album: draft?.album || st?.album || album,
      storage_album: album,
      status: st?.phase || '',
      state: '',
      stage: '',
      progress: null,
      message: '',
      updated: st?.updated || '',
      contributor: st?.contributor || '',
      is_update: !!st?.is_update,
    };
  }));
  for (const item of reviewItems) {
    if (!item) continue;
    refs.add(item.ref);
    pending.push(item);
  }
  const manifests = webObjects.filter((o) => {
    const parts = o.key.split('/');
    return parts.length === 3 && parts[0] === 'web' && parts[2] === 'manifest.json' && cleanRef(parts[1]);
  });
  const usedRefs = new Set(webObjects
    .map((o) => o.key.match(/^web\/([0-9a-f]{16,64})\/.used$/)?.[1])
    .filter(Boolean));
  for (const object of manifests) {
    const [, ref] = object.key.split('/');
    if (refs.has(ref) || usedRefs.has(ref)) continue;
    const worker = await callWorker(env, `/state?ref=${encodeURIComponent(ref)}`, null, 'GET');
    const job = worker.ok && worker.data && worker.data.state !== 'unknown' ? worker.data : null;
    if (!job || !['queued', 'dispatching', 'running', 'failed'].includes(job.state)) continue;
    const manifest = (await readJson(env, object.key)) || {};
    pending.push({
      ref,
      album: manifest.album || '',
      storage_album: manifest.album || '',
      status: job.state === 'failed' ? 'failed' : 'processing',
      state: job.state || '',
      stage: job.stage || '',
      progress: Number.isFinite(Number(job.progress)) ? Number(job.progress) : null,
      message: job.message || '',
      updated: manifest.updated || object.uploaded?.toISOString?.() || '',
      contributor: manifest.contributor || '',
      is_update: false,
    });
    refs.add(ref);
  }
  await Promise.all(pending.map(async (item) => {
    if (item.state) return;
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
