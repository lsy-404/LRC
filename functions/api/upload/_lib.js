// upload 代理共享工具：路径清洗与编排 Worker 调用。

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function callWorker(env, path, body, method = 'POST') {
  if (typeof env.INGEST_INTERNAL_CALL !== 'function') {
    return { ok: false, status: 503, data: { error: 'ingest is not available in this runtime' } };
  }
  try {
    return await env.INGEST_INTERNAL_CALL(path, body, method);
  } catch {
    return { ok: false, status: 503, data: { error: 'ingest unavailable; retry this submission' } };
  }
}

// 控制字符（C0 与 DEL）
function hasControlChar(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// 专辑名即投稿里的顶层文件夹名
export function cleanAlbum(name) {
  if (typeof name !== 'string') return null;
  const n = name.normalize('NFC').trim();
  if (!n || n.length > 120) return null;
  if (hasControlChar(n) || n.includes('/') || n.includes('\\')) return null;
  if (n === '.' || n === '..' || n.startsWith('.git')) return null;
  return n;
}

// 一次投稿一个 session，桶内按序号编址：对象 key = web/<session>/<n>。
// 上限与 finalize 接受的清单条数一致，两处共用避免各写各的。
export const MAX_FILES = 500;

export function cleanSession(s) {
  return typeof s === 'string' && /^[0-9a-f]{16,64}$/.test(s) ? s : null;
}

// 0 是合法序号，调用方须用 === null 判断非法
export function cleanIndex(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < MAX_FILES ? n : null;
}

// 专辑内相对路径：拒绝穿越、绝对路径、控制字符
export function cleanRelPath(p) {
  if (typeof p !== 'string') return null;
  const parts = p.normalize('NFC').replaceAll('\\', '/').split('/').filter(Boolean);
  if (!parts.length || parts.length > 10) return null;
  for (const s of parts) {
    if (s === '.' || s === '..' || s.length > 200 || hasControlChar(s)) return null;
  }
  return parts.join('/');
}
