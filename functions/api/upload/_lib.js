// upload 代理共享工具：鉴权、路径清洗、编排 Worker 调用。

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// 摘要后比较：等长、恒时
async function secretOk(candidate, expected) {
  if (typeof candidate !== 'string' || !candidate || !expected) return false;
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 贡献者投稿口令（浏览器侧）
export function passwordOk(candidate, env) {
  return secretOk(candidate, env.UPLOAD_PASSWORD);
}

// 客户端将密码 encodeURIComponent 后放入 Bearer（HTTP 头不允许非 Latin-1）
export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return '';
  try {
    return decodeURIComponent(h.slice(7));
  } catch {
    return '';
  }
}

// 摄取编排在独立 Worker（Pages Functions 绑不了容器），凭 INGEST_TOKEN 调用
export async function callWorker(env, path, body) {
  if (!env.INGEST_WORKER_URL || !env.INGEST_TOKEN) {
    return { ok: false, status: 503, data: { error: 'ingest worker not configured' } };
  }
  const resp = await fetch(`${env.INGEST_WORKER_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.INGEST_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
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
