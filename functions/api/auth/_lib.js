// 账号共享工具：会话 Cookie、用户目录与 requireUser 守卫；登录本身走统一身份（worker/src/studio.js）。

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(byteLength) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

export const TOKEN_BYTES = 32;

function hasControlChar(s) {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function cleanDisplayName(v, fallback) {
  if (typeof v !== 'string') return fallback;
  const n = v.normalize('NFC').trim();
  if (!n || n.length > 60 || hasControlChar(n)) return fallback;
  return n;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, salt, iterations, subject, ...rest } = user;
  return rest;
}

export function directory(env) {
  return env.USERS.getByName('directory');
}

// ---- session cookie ----

export const SESSION_COOKIE = 'lrc_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function setSessionCookie(headers, token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  headers.append('set-cookie',
    `${SESSION_COOKIE}=${token}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Strict`);
}

export function clearSessionCookie(headers) {
  headers.append('set-cookie',
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

export function readSessionToken(request) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return '';
}

export function jsonWithHeaders(data, status, headers) {
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

// ---- guards ----

// worker/src/api.js authorizes every API request through the studio solution and hands the account
// over as env.STUDIO_USER; the session lookup below only serves handlers invoked directly.
export async function requireUser({ request, env }) {
  if (env.STUDIO_USER) return env.STUDIO_USER;
  const token = readSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const user = await directory(env).resolveSession(tokenHash, Date.now());
  return user || null;
}
