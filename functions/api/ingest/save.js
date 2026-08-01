import {
  json, passwordOk, bearer, cleanRef, cleanAlbum,
  REVIEW, readJson, writeJson, nowStamp,
} from './_lib.js';

// POST /api/ingest/save { ref, album, draft } — 保存人工校正后的草稿。
// 同时刷新 status.updated 并标记 edited，避免编辑期间被超时闸门抢跑。
export async function onRequestPost({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const body = await request.json().catch(() => null);
  const ref = cleanRef(body?.ref);
  const album = cleanAlbum(body?.album);
  const draft = body?.draft;
  if (!ref || !album || !draft || typeof draft !== 'object') {
    return json({ error: 'bad request' }, 400);
  }

  const base = `${REVIEW}/${ref}/${album}`;
  const status = (await readJson(env, `${base}/status.json`)) || {};
  status.updated = nowStamp();
  status.edited = true;

  await writeJson(env, `${base}/draft.json`, draft);
  await writeJson(env, `${base}/status.json`, status);
  return json({ ok: true, ref, album });
}
