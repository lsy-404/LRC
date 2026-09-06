// review bundle 存在 R2 的 review/<ref>/<专辑>/ 下。
// 面板的增删改查与编排均在同一个 Worker 内完成。

export { json, callWorker, cleanAlbum } from '../upload/_lib.js';
export { requireUser } from '../auth/_lib.js';

export const REVIEW = 'review';

// ref = 上传会话号；旧的 40 位提交 SHA 也落在这个区间，缓存里的历史值不会被误拒
const REF_RE = /^[0-9a-f]{16,64}$/;
export function cleanRef(r) {
  return typeof r === 'string' && REF_RE.test(r) ? r : null;
}

export async function listPrefix(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.UPLOAD_BUCKET.list({ prefix, cursor, limit: 1000 });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function readJson(env, key) {
  const obj = await env.UPLOAD_BUCKET.get(key);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

export function writeJson(env, key, value) {
  return env.UPLOAD_BUCKET.put(key, JSON.stringify(value, null, 2),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
}

export async function deletePrefix(env, prefix) {
  const objects = await listPrefix(env, prefix);
  const keys = objects.map((o) => o.key);
  for (let i = 0; i < keys.length; i += 1000) {
    await env.UPLOAD_BUCKET.delete(keys.slice(i, i + 1000));
  }
  return keys.length;
}

export function nowStamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const AUDIO_EXTS = new Map([
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.flac', 'audio/flac'],
  ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'], ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'], ['.webm', 'audio/webm'], ['.wma', 'audio/x-ms-wma'],
]);

export function audioContentType(name) {
  const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  return dot >= 0 ? (AUDIO_EXTS.get(name.slice(dot).toLowerCase()) || '') : '';
}

function sniffAudioContentType(bytes, fallback) {
  const at = (index) => bytes[index] ?? -1;
  const text = (start, value) => value.split('').every((char, index) => at(start + index) === char.charCodeAt(0));
  if (text(0, 'fLaC')) return 'audio/flac';
  if (text(0, 'OggS')) return 'audio/ogg';
  if (text(0, 'RIFF') && text(8, 'WAVE')) return 'audio/wav';
  if (text(0, 'ID3') || (at(0) === 0xff && (at(1) & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (text(4, 'ftyp')) return 'audio/mp4';
  return fallback;
}

export async function detectedAudioContentType(bucket, key, fallback) {
  const probe = await bucket.get(key, { range: { offset: 0, length: 16 } });
  if (!probe?.body) return fallback;
  const bytes = new Uint8Array(await new Response(probe.body).arrayBuffer());
  return sniffAudioContentType(bytes, fallback);
}

// 只支持单段 bytes=<start>-<end> 范围；null=无 Range 头，undefined=Range 头存在但无法满足（调用方应回 416）。
export function parseByteRange(value, size) {
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
