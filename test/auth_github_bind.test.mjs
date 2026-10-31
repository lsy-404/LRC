import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleApi } from './worker/_studio.mjs';
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

function locationParams(response) {
  const location = response.headers.get('location') || '';
  const qs = location.includes('?') ? location.slice(location.indexOf('?') + 1) : '';
  return Object.fromEntries(new URLSearchParams(qs));
}

// 不打真实网络：把 token 交换与读 login 都换成受控替身，走 env.GITHUB_FETCH 注入点
function fakeGithubFetch({ tokenByCode = {}, loginByToken = {} } = {}) {
  return async function fetchStub(url, init) {
    const target = String(url);
    if (target.startsWith('https://github.com/login/oauth/access_token')) {
      const body = JSON.parse(init.body);
      const token = tokenByCode[body.code];
      return new Response(JSON.stringify(token ? { access_token: token } : { error: 'bad_verification_code' }));
    }
    if (target.startsWith('https://api.github.com/user')) {
      const auth = init.headers.authorization || '';
      const token = auth.replace(/^token /, '');
      const login = loginByToken[token];
      return new Response(JSON.stringify(login ? { login } : {}), { status: login ? 200 : 401 });
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
}

function freshEnv({ configured = true, github } = {}) {
  const dir = createFakeDirectory();
  const env = { USERS: usersBinding(dir) };
  if (configured) {
    env.GITHUB_OAUTH_CLIENT_ID = 'client-id';
    env.GITHUB_OAUTH_CLIENT_SECRET = 'client-secret';
    env.GITHUB_FETCH = fakeGithubFetch(github);
  }
  return { env, dir };
}

// 统一身份登录后的会话直接落到用户目录：GitHub 绑定只关心当前会话属于谁。
async function signIn(env, name) {
  const dir = env.USERS.getByName('directory');
  const { user } = await dir.createUser({ name, display_name: name, role: 'editor', password_hash: '', salt: '', iterations: 0 });
  const token = `${name}-session`;
  await dir.createSession({ token_hash: createHash('sha256').update(token).digest('hex'), user_id: user.id, issued_at: Date.now(), expires_at: Date.now() + 3600000 });
  return { cookie: `lrc_session=${token}`, user: await dir.getUserById(user.id) };
}

const bootstrapAdmin = (env, name = 'root') => signIn(env, name);
const registerEditor = (env, _adminCookie, name) => signIn(env, name);

async function startFlow(env, cookie) {
  const res = await handleApi(req('https://x/api/auth/github/start', { cookie }), env);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  return location.searchParams.get('state');
}

test('未登录访问 start 被拒', async () => {
  const { env } = freshEnv();
  const res = await handleApi(req('https://x/api/auth/github/start'), env);
  assert.equal(res.status, 401);
});

test('未配置 GITHUB_OAUTH secret 时 start 优雅降级，不崩溃', async () => {
  const { env } = freshEnv({ configured: false });
  const { cookie } = await bootstrapAdmin(env);
  const res = await handleApi(req('https://x/api/auth/github/start', { cookie }), env);
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /not configured/);
});

test('已登录且已配置时 start 重定向到 GitHub 授权页，scope 留空', async () => {
  const { env } = freshEnv();
  const { cookie } = await bootstrapAdmin(env);
  const res = await handleApi(req('https://x/api/auth/github/start', { cookie }), env);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://lrc.leisiyu.dev/api/auth/github/callback');
  assert.ok(location.searchParams.get('state'));
  assert.equal(location.searchParams.has('scope'), false);
});

test('callback 用伪造 state 被拒，不建立绑定', async () => {
  const { env } = freshEnv({ github: { tokenByCode: { c1: 't1' }, loginByToken: { t1: 'octocat' } } });
  const { user } = await bootstrapAdmin(env);
  const res = await handleApi(req('https://x/api/auth/github/callback?state=forged&code=c1'), env);
  assert.equal(res.status, 302);
  assert.deepEqual(locationParams(res), { github: 'error', reason: 'invalid_state' });
  assert.equal(user.github, null);
});

test('state 只能用一次：正常走完一次后，重放同一个 state 被拒', async () => {
  const github = { tokenByCode: { 'good-code': 'tok-1' }, loginByToken: { 'tok-1': 'octocat' } };
  const { env, dir } = freshEnv({ github });
  const { cookie, user } = await bootstrapAdmin(env);
  const state = await startFlow(env, cookie);

  const first = await handleApi(req(`https://x/api/auth/github/callback?state=${state}&code=good-code`), env);
  assert.equal(first.status, 302);
  assert.deepEqual(locationParams(first), { github: 'connected' });
  assert.equal(dir.getUserById(user.id).github, 'octocat');

  const replay = await handleApi(req(`https://x/api/auth/github/callback?state=${state}&code=good-code`), env);
  assert.equal(replay.status, 302);
  assert.deepEqual(locationParams(replay), { github: 'error', reason: 'invalid_state' });
});

test('过期 state 被拒', async () => {
  const github = { tokenByCode: { c: 't' }, loginByToken: { t: 'someone' } };
  const { env, dir } = freshEnv({ github });
  const { user } = await bootstrapAdmin(env);
  const now = Date.now();
  dir.createOAuthState({ state: 'stale', user_id: user.id, created_at: now - 20_000, expires_at: now - 1000 });

  const res = await handleApi(req('https://x/api/auth/github/callback?state=stale&code=c'), env);
  assert.equal(res.status, 302);
  assert.deepEqual(locationParams(res), { github: 'error', reason: 'invalid_state' });
});

test('同一个 GitHub 账号不能绑定到两个站内账号', async () => {
  const github = {
    tokenByCode: { 'code-a': 'tok-a', 'code-b': 'tok-b' },
    loginByToken: { 'tok-a': 'shared-handle', 'tok-b': 'shared-handle' },
  };
  const { env, dir } = freshEnv({ github });
  const { cookie: adminCookie, user: admin } = await bootstrapAdmin(env);
  const { cookie: editorCookie, user: editor } = await registerEditor(env, adminCookie, 'editor1');

  const stateA = await startFlow(env, adminCookie);
  const boundA = await handleApi(req(`https://x/api/auth/github/callback?state=${stateA}&code=code-a`), env);
  assert.deepEqual(locationParams(boundA), { github: 'connected' });

  const stateB = await startFlow(env, editorCookie);
  const boundB = await handleApi(req(`https://x/api/auth/github/callback?state=${stateB}&code=code-b`), env);
  assert.deepEqual(locationParams(boundB), { github: 'error', reason: 'taken' });

  assert.equal(dir.getUserById(admin.id).github, 'shared-handle');
  assert.equal(dir.getUserById(editor.id).github, null);
});

test('解绑清除 github 字段，且需要登录', async () => {
  const github = { tokenByCode: { c: 't' }, loginByToken: { t: 'someone' } };
  const { env, dir } = freshEnv({ github });
  const { cookie, user } = await bootstrapAdmin(env);
  const state = await startFlow(env, cookie);
  await handleApi(req(`https://x/api/auth/github/callback?state=${state}&code=c`), env);
  assert.equal(dir.getUserById(user.id).github, 'someone');

  const unauthed = await handleApi(req('https://x/api/auth/github', { method: 'DELETE' }), env);
  assert.equal(unauthed.status, 401);

  const res = await handleApi(req('https://x/api/auth/github', { method: 'DELETE', cookie }), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.github, null);
  assert.equal(dir.getUserById(user.id).github, null);
});
