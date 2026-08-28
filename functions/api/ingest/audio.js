import { json, passwordOk, bearer, cleanRef, readJson } from './_lib.js';

const AUDIO_EXTS = new Map([
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'], ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'], ['.webm', 'audio/webm'], ['.wma', 'audio/x-ms-wma'],
]);

function baseName(path) {
  return typeof path === 'string' ? path.split('/').at(-1) : '';
}

function contentType(name) {
  const dot = name.lastIndexOf('.');
  return AUDIO_EXTS.get(name.slice(dot).toLowerCase()) || '';
}

function sniffContentType(bytes, fallback) {
  const at = (index) => bytes[index] ?? -1;
  const text = (start, value) => value.split('').every((char, index) => at(start + index) === char.charCodeAt(0));
  if (text(0, 'fLaC')) return 'audio/flac';
  if (text(0, 'OggS')) return 'audio/ogg';
  if (text(0, 'RIFF') && text(8, 'WAVE')) return 'audio/wav';
  if (text(0, 'ID3') || (at(0) === 0xff && (at(1) & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (text(4, 'ftyp')) return 'audio/mp4';
  return fallback;
}

async function detectedContentType(bucket, key, fallback) {
  const probe = await bucket.get(key, { range: { offset: 0, length: 16 } });
  if (!probe?.body) return fallback;
  const bytes = new Uint8Array(await new Response(probe.body).arrayBuffer());
  return sniffContentType(bytes, fallback);
}

function parseRange(value, size) {
  if (!value || !value.startsWith('bytes=') || value.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;
  const start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd));
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return undefined;
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

// GET /api/ingest/audio?ref=&name= — 审核期原音试听。
// 只允许清单中精确匹配的音频 basename；响应体从 R2 直流式读取，不产生公开对象 URL。
export async function onRequestGet({ request, env }) {
  if (!(await passwordOk(bearer(request), env))) return json({ error: 'unauthorized' }, 401);
  if (!env.UPLOAD_BUCKET) return json({ error: 'r2 not configured' }, 503);

  const url = new URL(request.url);
  const ref = cleanRef(url.searchParams.get('ref'));
  const name = url.searchParams.get('name') || '';
  if (!ref || !name || baseName(name) !== name || !contentType(name)) return json({ error: 'bad request' }, 400);

  const manifest = await readJson(env, `web/${ref}/manifest.json`);
  const matches = (manifest?.files || []).filter((file) => baseName(file?.path) === name && contentType(file.path));
  if (matches.length !== 1 || !Number.isInteger(matches[0].n)) return json({ error: 'audio not found' }, 404);

  const key = `web/${ref}/${matches[0].n}`;
  const head = await env.UPLOAD_BUCKET.head?.(key);
  const size = Number(head?.size ?? matches[0].size);
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'audio not found' }, 404);
  const range = parseRange(request.headers.get('range'), size);
  if (range === undefined) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });

  const type = await detectedContentType(env.UPLOAD_BUCKET, key, contentType(name));
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
