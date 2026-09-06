import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/src/api.js';
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
  return { UPLOAD_PASSWORD: 'root-secret', USERS: usersBinding(dir) };
}

async function bootstrapAdmin(env, name = 'root') {
  const res = await handleApi(req('https://x/api/auth/bootstrap', {
    method: 'POST', body: { token: 'root-secret', name, password: 'a-strong-pass' },
  }), env);
  return { cookie: cookieOf(res), user: (await res.json()).user };
}

async function inviteAndRegister(env, adminCookie, name, role) {
  const inviteRes = await handleApi(req('https://x/api/auth/invite', {
    method: 'POST', body: { role }, cookie: adminCookie,
  }), env);
  const { code } = await inviteRes.json();
  const registered = await handleApi(req('https://x/api/auth/register', {
    method: 'POST', body: { invite_code: code, name, password: 'password123' },
  }), env);
  return { cookie: cookieOf(registered), user: (await registered.json()).user };
}

test('编辑者可以访问 requireUser 守卫的端点', async () => {
  const env = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  const { cookie: editorCookie } = await inviteAndRegister(env, adminCookie, 'ed1', 'editor');

  const me = await handleApi(req('https://x/api/auth/me', { cookie: editorCookie }), env);
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.role, 'editor');
});

test('编辑者不能发邀请，也不能管理用户', async () => {
  const env = await freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  const { cookie: editorCookie, user: editor } = await inviteAndRegister(env, adminCookie, 'ed2', 'editor');

  const createInvite = await handleApi(req('https://x/api/auth/invite', {
    method: 'POST', body: {}, cookie: editorCookie,
  }), env);
  assert.equal(createInvite.status, 403);

  const listInvites = await handleApi(req('https://x/api/auth/invites', { cookie: editorCookie }), env);
  assert.equal(listInvites.status, 403);

  const listUsers = await handleApi(req('https://x/api/auth/users', { cookie: editorCookie }), env);
  assert.equal(listUsers.status, 403);

  const patchUser = await handleApi(req('https://x/api/auth/user', {
    method: 'PATCH', body: { id: editor.id, role: 'admin' }, cookie: editorCookie,
  }), env);
  assert.equal(patchUser.status, 403);
});

test('最后一名管理员不可被降级或停用', async () => {
  const env = await freshEnv();
  const { cookie: adminCookie, user: admin } = await bootstrapAdmin(env);

  const demoteSelf = await handleApi(req('https://x/api/auth/user', {
    method: 'PATCH', body: { id: admin.id, role: 'editor' }, cookie: adminCookie,
  }), env);
  assert.equal(demoteSelf.status, 409);

  const disableSelf = await handleApi(req('https://x/api/auth/user', {
    method: 'PATCH', body: { id: admin.id, status: 'disabled' }, cookie: adminCookie,
  }), env);
  assert.equal(disableSelf.status, 409);

  // 场上有第二名在任管理员时，第一名才能被降级
  const { cookie: admin2Cookie, user: admin2 } = await inviteAndRegister(env, adminCookie, 'root2', 'admin');
  const demoteOk = await handleApi(req('https://x/api/auth/user', {
    method: 'PATCH', body: { id: admin.id, role: 'editor' }, cookie: adminCookie,
  }), env);
  assert.equal(demoteOk.status, 200);

  // 现在只剩 admin2 一名管理员，它同样不能自我降级
  const lastOneLeft = await handleApi(req('https://x/api/auth/user', {
    method: 'PATCH', body: { id: admin2.id, role: 'editor' }, cookie: admin2Cookie,
  }), env);
  assert.equal(lastOneLeft.status, 409);
});

test('disabled editors lose existing business and account sessions immediately', async () => {
  const env = freshEnv();
  const { cookie: adminCookie } = await bootstrapAdmin(env);
  const { cookie, user } = await inviteAndRegister(env, adminCookie, 'disabled-editor', 'editor');
  const disabled = await handleApi(req('https://x/api/auth/user', { method: 'PATCH', cookie: adminCookie, body: { id: user.id, status: 'disabled' } }), env);
  assert.equal(disabled.status, 200);
  assert.equal((await handleApi(req('https://x/api/auth/me', { cookie }), env)).status, 401);
  assert.equal((await handleApi(req('https://x/api/ingest/list', { cookie }), env)).status, 401);
});
