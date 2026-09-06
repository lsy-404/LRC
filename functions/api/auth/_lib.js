// 账号鉴权共享工具：口令派生、会话 Cookie、requireUser / requireAdmin 守卫。

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export function randomHex(byteLength) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 引导口令（env.UPLOAD_PASSWORD）用摘要恒时比较，做法与 upload/_lib.js 的 secretOk 一致
export async function secretEquals(candidate, expected) {
  if (typeof candidate !== 'string' || !candidate || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(expected)]);
  return timingSafeEqualHex(a, b);
}

// PBKDF2-HMAC-SHA256，迭代数入库，取值与实测耗时见 findings.md
export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
export const TOKEN_BYTES = 32;
export const INVITE_BYTES = 16;

async function pbkdf2Hex(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export async function hashPassword(password) {
  const salt = randomHex(SALT_BYTES);
  const iterations = PBKDF2_ITERATIONS;
  const password_hash = await pbkdf2Hex(password, salt, iterations);
  return { password_hash, salt, iterations };
}

export async function verifyPassword(password, user) {
  const candidate = await pbkdf2Hex(password, user.salt, user.iterations);
  return timingSafeEqualHex(candidate, user.password_hash);
}

// 用户不存在时也要跑一次等量的 PBKDF2，抹平「查得到/查不到」之间的耗时差
const DUMMY_USER = { salt: '0'.repeat(SALT_BYTES * 2), iterations: PBKDF2_ITERATIONS, password_hash: '0'.repeat(64) };
export async function verifyPasswordOrDummy(password, user) {
  if (!user) {
    await verifyPassword(password || '', DUMMY_USER);
    return false;
  }
  return verifyPassword(password || '', user);
}

// 用户名：3-32 位小写字母数字下划线连字符
const NAME_RE = /^[a-z0-9_-]{3,32}$/;
export function cleanUsername(v) {
  return typeof v === 'string' && NAME_RE.test(v) ? v : null;
}

export function validPassword(v) {
  return typeof v === 'string' && v.length >= 8 && v.length <= 200;
}

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
  const { password_hash, salt, iterations, ...rest } = user;
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

export async function issueSession(env, userId, headers) {
  const token = randomHex(TOKEN_BYTES);
  const tokenHash = await sha256Hex(token);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  await directory(env).createSession({
    token_hash: tokenHash, user_id: userId, issued_at: issuedAt, expires_at: expiresAt,
  });
  setSessionCookie(headers, token, expiresAt);
}

export function jsonWithHeaders(data, status, headers) {
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

// ---- guards ----

export async function requireUser({ request, env }) {
  const token = readSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const user = await directory(env).resolveSession(tokenHash, Date.now());
  return user || null;
}

export async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  return user && user.role === 'admin' ? user : null;
}
