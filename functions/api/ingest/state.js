import { json, passwordOk, bearer, cleanRef, REVIEW, listPrefix, readJson } from './_lib.js';

// GET /api/ingest/state?ref= — 供修改面板轮询。
// 返回该 ref 下每张专辑的 status + draft（可编辑对象；不含词流 stt）。
// 前缀为空 → status:'processing'（Phase A 还没写完，或已被 Phase B 清理）。
export async function onRequestGet({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const ref = cleanRef(new URL(request.url).searchParams.get('ref'));
  if (!ref) return json({ error: 'bad ref' }, 400);

  const objects = await listPrefix(env, `${REVIEW}/${ref}/`);
  if (!objects.length) return json({ ref, status: 'processing', albums: [] });

  const albumNames = objects
    .filter((o) => o.key.endsWith('/draft.json'))
    .map((o) => o.key.split('/')[2])
    .filter(Boolean);

  const albums = [];
  for (const album of albumNames) {
    const base = `${REVIEW}/${ref}/${album}`;
    const [draft, status] = await Promise.all([
      readJson(env, `${base}/draft.json`),
      readJson(env, `${base}/status.json`),
    ]);
    albums.push({ album, status: status || {}, draft });
  }
  return json({ ref, status: 'ready', albums });
}
