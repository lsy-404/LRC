import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/src/api.js';
import { sha256Hex } from '../functions/api/auth/_lib.js';
import { createFakeDirectory, usersBinding } from './worker/_fakeUserDirectory.mjs';

function req(url, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

function cookieOf(response) {
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

function freshEnv() {
  const dir = createFakeDirectory();
  return { env: { UPLOAD_PASSWORD: 'root-secret', USERS: usersBinding(dir) }, dir };
}

async function bootstrapAdmin(env, name = 'root') {
  const res = await handleApi(req('https://x/api/auth/bootstrap', {
    method: 'POST', body: { token: 'root-secret', name, password: 'a-strong-pass' },
  }), env);
  return { response: res, cookie: cookieOf(res), user: (await res.json()).user };
}

test('bootstrap 用 UPLOAD_PASSWORD 建立首个管理员，且只能用一次', async () => {
  const { env } = await freshEnv();
  const bad = await handleApi(req('https://x/api/auth/bootstrap', {
    method: 'POST', body: { token: 'wrong', name: 'root', password: 'a-strong-pass' },
  }), env);
  assert.equal(bad.status, 401);

  const { response, user } = await bootstrapAdmin(env);
  assert.equal(response.status, 201);
  assert.equal(user.role, 'admin');
  assert.ok(cookieOf(response).startsWith('lrc_session='));

  const second = await handleApi(req('https://x/api/auth/bootstrap', {
    method: 'POST', body: { token: 'root-secret', name: 'root2', password: 'a-strong-pass' },
  }), env);
  assert.equal(second.status, 409);
});

test('注册必须带邀请码，无邀请码直接拒绝', async () => {
  const { env } = await freshEnv();
  const res = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { name: 'alice', password: 'password123' },
  }), env);
  assert.equal(res.status, 400);
});

test('邀请码一次性使用，注册成功后复用被拒', async () => {
  const { env } = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  const inviteRes = await handleApi(req('https://x/api/auth/invite', {
    method: 'POST', body: {}, cookie: adminCookie,
  }), env);
  assert.equal(inviteRes.status, 201);
  const { code } = await inviteRes.json();

  const registered = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: code, name: 'alice', password: 'password123' },
  }), env);
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).user.role, 'editor');

  const reused = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: code, name: 'bob', password: 'password123' },
  }), env);
  assert.equal(reused.status, 400);
});

test('并发用同一个邀请码注册，只有一个请求成功', async () => {
  const { env, dir } = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  const inviteRes = await handleApi(req('https://x/api/auth/invite', {
    method: 'POST', body: {}, cookie: adminCookie,
  }), env);
  const { code } = await inviteRes.json();

  // 两个请求真正并发发出（Promise.all，不是先后 await），复现「查未用 -> 慢操作 -> 才回写已用」
  // 之间的窗口：register.js 内部有 PBKDF2 派生等多个真实异步操作，两个 handleApi 调用会天然交错。
  const [first, second] = await Promise.all([
    handleApi(req('https://x/api/auth/register', {
      method: 'POST', body: { invite_code: code, name: 'racer-a', password: 'password123' },
    }), env),
    handleApi(req('https://x/api/auth/register', {
      method: 'POST', body: { invite_code: code, name: 'racer-b', password: 'password123' },
    }), env),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [201, 400]);
  const winner = first.status === 201 ? first : second;
  const { user: winnerUser } = await winner.json();

  // 邀请码最终只被赢家消费一次，不是残留成占位值或者被两次注册各写一半
  const invite = dir.getInvite(await sha256Hex(code));
  assert.equal(invite.used_by, winnerUser.id);

  // 只有赢家那个用户名真正建号成功
  assert.equal(dir.getUserByName('racer-a') !== null, first.status === 201);
  assert.equal(dir.getUserByName('racer-b') !== null, second.status === 201);
});

test('过期邀请码被拒', async () => {
  const { env, dir } = await freshEnv();
  const { user: admin } = await bootstrapAdmin(env);
  const code = 'a'.repeat(32);
  await dir.createInvite({
    code_hash: await sha256Hex(code), role: 'editor',
    created_by: admin.id, created_at: Date.now() - 10_000, expires_at: Date.now() - 1000,
  });
  const res = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: code, name: 'carol', password: 'password123' },
  }), env);
  assert.equal(res.status, 400);
});

test('用户名重复被拒', async () => {
  const { env } = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  async function invite() {
    const r = await handleApi(req('https://x/api/auth/invite', {
      method: 'POST', body: {}, cookie: adminCookie,
    }), env);
    return (await r.json()).code;
  }

  const first = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: await invite(), name: 'dupuser', password: 'password123' },
  }), env);
  assert.equal(first.status, 201);

  const dup = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: await invite(), name: 'dupuser', password: 'password123' },
  }), env);
  assert.equal(dup.status, 409);
});

test('登录失败不泄漏用户是否存在，响应体一致且耗时接近', async () => {
  const { env } = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  const inviteRes = await handleApi(req('https://x/api/auth/invite', {
    method: 'POST', body: {}, cookie: adminCookie,
  }), env);
  const { code } = await inviteRes.json();
  await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: code, name: 'erin', password: 'password123' },
  }), env);

  // 预热一次，避开首次调用的 JIT/模块加载抖动
  await handleApi(req('https://x/api/auth/login', {
    method: 'POST', body: { name: 'erin', password: 'wrong-pass' },
  }), env);

  const t0 = performance.now();
  const wrongPassword = await handleApi(req('https://x/api/auth/login', {
    method: 'POST', body: { name: 'erin', password: 'wrong-pass' },
  }), env);
  const t1 = performance.now();
  const noSuchUser = await handleApi(req('https://x/api/auth/login', {
    method: 'POST', body: { name: 'nobody-here', password: 'wrong-pass' },
  }), env);
  const t2 = performance.now();

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  assert.deepEqual(await wrongPassword.json(), await noSuchUser.json());
  // 两条路径都跑同一次 PBKDF2：耗时差应该远小于一次哈希本身的耗时，而不是「一次哈希、一次几乎不耗时」
  assert.ok(Math.abs((t1 - t0) - (t2 - t1)) < 300, '用户存在与否不应造成明显的响应耗时差异');
});

test('会话过期后被拒绝，且登出会清除会话', async () => {
  const { env, dir } = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);

  const ok = await handleApi(req('https://x/api/auth/me', { cookie: adminCookie }), env);
  assert.equal(ok.status, 200);

  const token = adminCookie.slice('lrc_session='.length);
  const tokenHash = await sha256Hex(token);
  dir.expireSessionForTest(tokenHash);

  const expired = await handleApi(req('https://x/api/auth/me', { cookie: adminCookie }), env);
  assert.equal(expired.status, 401);
});

test('登出会清除当前会话', async () => {
  const { env } = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  assert.equal((await handleApi(req('https://x/api/auth/me', { cookie: adminCookie }), env)).status, 200);

  const logout = await handleApi(req('https://x/api/auth/logout', { method: 'POST', cookie: adminCookie }), env);
  assert.equal(logout.status, 200);

  const afterLogout = await handleApi(req('https://x/api/auth/me', { cookie: adminCookie }), env);
  assert.equal(afterLogout.status, 401);
});

test('password change invalidates every old session and the old password', async () => {
  const { env } = freshEnv();
  const { cookie: first } = await bootstrapAdmin(env);
  const login = await handleApi(req('https://x/api/auth/login', { method: 'POST', body: { name: 'root', password: 'a-strong-pass' } }), env);
  const second = cookieOf(login);
  const changed = await handleApi(req('https://x/api/auth/me', { method: 'PATCH', cookie: first, body: { old_password: 'a-strong-pass', new_password: 'changed-password' } }), env);
  assert.equal(changed.status, 200);
  for (const cookie of [first, second]) {
    assert.equal((await handleApi(req('https://x/api/auth/me', { cookie }), env)).status, 401);
  }
  assert.equal((await handleApi(req('https://x/api/auth/login', { method: 'POST', body: { name: 'root', password: 'a-strong-pass' } }), env)).status, 401);
  assert.equal((await handleApi(req('https://x/api/auth/login', { method: 'POST', body: { name: 'root', password: 'changed-password' } }), env)).status, 200);
});
