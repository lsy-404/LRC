// upload 代理共享工具：鉴权、路径清洗、GitHub API 头

export const REPO = 'wuyilingwei/LRC';
export const BRANCH = 'upload';
export const GH_API = 'https://api.github.com';
export const SHA_RE = /^[0-9a-f]{40}$/;

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
export async function passwordOk(candidate, env) {
  if (typeof candidate !== 'string' || !candidate || !env.UPLOAD_PASSWORD) return false;
  const [a, b] = await Promise.all([sha256(candidate), sha256(env.UPLOAD_PASSWORD)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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

export function ghHeaders(env, extra = {}) {
  return {
    authorization: `Bearer ${env.GH_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'lrc-upload-proxy',
    'x-github-api-version': '2022-11-28',
    ...extra,
  };
}

// 控制字符（C0 与 DEL）
function hasControlChar(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// 专辑名即 upload 分支顶层文件夹名
export function cleanAlbum(name) {
  if (typeof name !== 'string') return null;
  const n = name.normalize('NFC').trim();
  if (!n || n.length > 120) return null;
  if (hasControlChar(n) || n.includes('/') || n.includes('\\')) return null;
  if (n === '.' || n === '..' || n.startsWith('.git')) return null;
  return n;
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

export function buildTreeEntries(album, files) {
  return files.map((f) => ({
    path: `${album}/${f.path}`,
    mode: '100644',
    type: 'blob',
    sha: f.sha,
  }));
}
