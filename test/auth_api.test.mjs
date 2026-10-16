import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, fakeStudio } from './worker/_studio.mjs';
import { authenticatedUsers, authedRequest } from './worker/_fakeR2.mjs';

test('统一身份与曲库路径先交给工作站方案处理', async () => {
  const seen = [];
  const studio = fakeStudio({ handle: async (request) => { const path = new URL(request.url).pathname; seen.push(path); return path.startsWith('/api/auth/sso/') || path.startsWith('/api/library/') ? Response.json({ owned: path }) : null; } });
  for (const path of ['/api/auth/sso/start', '/api/library/albums']) {
    const response = await handleApi(new Request(`https://x${path}`), { USERS: authenticatedUsers() }, studio);
    assert.deepEqual(await response.json(), { owned: path });
  }
  assert.deepEqual(seen, ['/api/auth/sso/start', '/api/library/albums']);
});

test('口令登录、注册、邀请与用户管理入口已下线', async () => {
  const env = { USERS: authenticatedUsers() };
  for (const [method, path] of [['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['POST', '/api/auth/bootstrap'], ['POST', '/api/auth/logout'], ['POST', '/api/auth/invite'], ['GET', '/api/auth/invites'], ['GET', '/api/auth/users'], ['PATCH', '/api/auth/user'], ['GET', '/api/auth/setup']]) {
    const response = await handleApi(authedRequest(`https://x${path}`, { method, body: method === 'GET' ? undefined : {} }), env);
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});

test('me 返回账号、曲库权限动作、身份提供方与 GitHub 配置，不泄漏口令与主体', async () => {
  const env = { USERS: authenticatedUsers(), GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret' };
  const response = await handleApi(authedRequest('https://x/api/auth/me'), env, fakeStudio({ actions: { submit: false } }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.user.name, 'editor');
  assert.equal(body.actions.submit, false);
  assert.equal(body.actions.edit, true);
  assert.equal(body.provider, 'Test Access');
  assert.equal(body.githubConfigured, true);
  for (const key of ['password_hash', 'salt', 'iterations', 'subject']) assert.equal(key in body.user, false);
});

test('me 只允许修改展示名，未登录返回 401', async () => {
  const env = { USERS: authenticatedUsers() };
  assert.equal((await handleApi(new Request('https://x/api/auth/me'), env)).status, 401);
  const renamed = await handleApi(authedRequest('https://x/api/auth/me', { method: 'PATCH', body: { display_name: '  新名字 ', new_password: 'ignored-password' } }), env);
  assert.equal((await renamed.json()).user.display_name, '新名字');
  const invalid = await handleApi(authedRequest('https://x/api/auth/me', { method: 'PATCH', body: { display_name: '' } }), env);
  assert.equal(invalid.status, 400);
});

test('跨站写请求在交给方案之前就被拒绝', async () => {
  let handled = false;
  const studio = fakeStudio({ handle: async () => { handled = true; return Response.json({ ok: true }); } });
  const request = new Request('https://x/api/auth/sso/logout', { method: 'POST', headers: { origin: 'https://evil.example' } });
  const response = await handleApi(request, { USERS: authenticatedUsers() }, studio);
  assert.equal(response.status, 403);
  assert.equal(handled, false);
});
