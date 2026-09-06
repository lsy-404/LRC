import {
  json, requireUser, callWorker, cleanRef, cleanAlbum,
  REVIEW, listPrefix, deletePrefix,
} from './_lib.js';

// POST /api/ingest/discard { ref, album } — 判定该草稿不要了，删掉整个 bundle。
// 原始上传持续保留在 R2；这里删的是可重新生成的审核派生态，不可恢复。
// 该 ref 下已无草稿时顺手撤掉编排里的超时闹钟，免得 72h 后又跑一次空的 Phase B。
export async function onRequestPost({ request, env }) {
  if (!(await requireUser({ request, env }))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const album = cleanAlbum(body?.album);
  if (!ref || !album) return json({ error: 'bad request' }, 400);

  const removed = await deletePrefix(env, `${REVIEW}/${ref}/${album}/`);
  if (!removed) return json({ error: 'not found', ref, album }, 404);

  const left = await listPrefix(env, `${REVIEW}/${ref}/`);
  if (!left.length) await callWorker(env, '/discard', { ref });

  return json({ ok: true, ref, album, removed });
}
