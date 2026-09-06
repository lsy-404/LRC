import {
  json, requireUser, cleanRef, readJson,
  audioContentType, detectedAudioContentType, parseByteRange,
} from './_lib.js';

function baseName(path) {
  return typeof path === 'string' ? path.split('/').at(-1) : '';
}

// GET /api/ingest/audio?ref=&name= — 审核期原音试听。
// 只允许清单中精确匹配的音频 basename；响应体从 R2 直流式读取，不产生公开对象 URL。
export async function onRequestGet({ request, env }) {
  if (!(await requireUser({ request, env }))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const url = new URL(request.url);
  const ref = cleanRef(url.searchParams.get('ref'));
  const name = url.searchParams.get('name') || '';
  if (!ref || !name || baseName(name) !== name || !audioContentType(name)) return json({ error: 'bad request' }, 400);

  const manifest = await readJson(env, `web/${ref}/manifest.json`);
  const matches = (manifest?.files || []).filter((file) => baseName(file?.path) === name && audioContentType(file.path));
  if (matches.length !== 1 || !Number.isInteger(matches[0].n)) return json({ error: 'audio not found' }, 404);

  const key = `web/${ref}/${matches[0].n}`;
  const head = await env.UPLOAD_BUCKET.head?.(key);
  const size = Number(head?.size ?? matches[0].size);
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'audio not found' }, 404);
  const range = parseByteRange(request.headers.get('range'), size);
  if (range === undefined) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });

  const type = await detectedAudioContentType(env.UPLOAD_BUCKET, key, audioContentType(name));
  const object = await env.UPLOAD_BUCKET.get(key, range ? { range } : undefined);
  if (!object?.body) return json({ error: 'audio not found' }, 404);
  const headers = new Headers({
    'content-type': type, 'accept-ranges': 'bytes',
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  });
  if (range) {
    headers.set('content-length', String(range.length));
    headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(object.body, { headers });
}
