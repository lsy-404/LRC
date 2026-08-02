// review bundle 存在 R2 的 review/<ref>/<专辑>/ 下（原先是 ingest-review 分支）。
// 面板的增删改查直接走桶绑定，作业编排才转交给独立 Worker。

export { json, passwordOk, bearer, callWorker, cleanAlbum } from '../upload/_lib.js';

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
