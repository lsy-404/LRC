import { json, requireUser, cleanRef, cleanAlbum, REVIEW } from './_lib.js';

// POST /api/ingest/cover?ref=&album=&ext=.jpg — 换封面，请求体为图片原始字节。
// 直接落到 bundle 里的 cover<ext>；draft.cover_ext 由面板保存时同步。
const MAX_BYTES = 20 * 1024 * 1024;
const EXT_RE = /^\.[a-z0-9]{1,5}$/;

export async function onRequestPost({ request, env }) {
  if (!(await requireUser({ request, env }))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const url = new URL(request.url);
  const ref = cleanRef(url.searchParams.get('ref'));
  const album = cleanAlbum(url.searchParams.get('album'));
  const ext = (url.searchParams.get('ext') || '').toLowerCase();
  if (!ref || !album || !EXT_RE.test(ext)) return json({ error: 'bad request' }, 400);

  const len = Number(request.headers.get('content-length'));
  if (!Number.isInteger(len) || len <= 0 || len > MAX_BYTES) {
    return json({ error: 'bad length' }, 400);
  }

  const obj = await env.UPLOAD_BUCKET.put(`${REVIEW}/${ref}/${album}/cover${ext}`, request.body);
  return json({ ok: true, ext, size: obj.size });
}
