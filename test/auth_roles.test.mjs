import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../worker/src/api.js';
import { handleApi, fakeStudio } from './worker/_studio.mjs';
import { authenticatedUsers, authedRequest, fakeBucket } from './worker/_fakeR2.mjs';

const ACTIONS = new Set(['browse', 'listen', 'edit', 'discard', 'submit', 'download', 'session', 'public']);

test('每条站内路由都声明了工作站动作，只有 GitHub 回调公开', () => {
  for (const [route, [handler, action]] of ROUTES) {
    assert.equal(typeof handler, 'function', route);
    assert.ok(ACTIONS.has(action), `${route} → ${action}`);
  }
  assert.deepEqual([...ROUTES].filter(([, [, action]]) => action === 'public').map(([route]) => route), ['GET /api/auth/github/callback']);
  assert.equal(ROUTES.get('POST /api/workspace/extract')[1], 'submit');
  assert.equal(ROUTES.get('POST /api/ingest/continue')[1], 'submit');
  assert.equal(ROUTES.get('POST /api/workspace/discard')[1], 'discard');
  assert.equal(ROUTES.get('GET /api/workspace/audio')[1], 'listen');
  assert.equal(ROUTES.get('POST /api/upload/r2')[1], 'edit');
});

test('没有单点登录会话时业务与账号路由一律 401', async () => {
  const env = { USERS: authenticatedUsers(), UPLOAD_BUCKET: fakeBucket() };
  for (const [method, path] of [['GET', '/api/workspace/list'], ['POST', '/api/workspace/create'], ['GET', '/api/ingest/list'], ['GET', '/api/auth/github/start']]) {
    const response = await handleApi(new Request(`https://x${path}`, { method }), env);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('缺少对应曲库权限时返回 403 且不执行处理器', async () => {
  const bucket = fakeBucket();
  const env = { USERS: authenticatedUsers(), UPLOAD_BUCKET: bucket };
  const denied = await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '专辑' } }), env, fakeStudio({ actions: { edit: false } }));
  assert.equal(denied.status, 403);
  assert.equal(bucket.store.size, 0);
  const browseOnly = fakeStudio({ actions: { edit: false, submit: false, discard: false, listen: false } });
  for (const [method, path] of [['POST', '/api/workspace/extract'], ['POST', '/api/ingest/continue'], ['POST', '/api/workspace/discard'], ['GET', '/api/workspace/audio'], ['POST', '/api/upload/r2']]) {
    const response = await handleApi(authedRequest(`https://x${path}`, { method, body: method === 'GET' ? undefined : {} }), env, browseOnly);
    assert.equal(response.status, 403, `${method} ${path}`);
  }
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/list'), env, browseOnly)).status, 200);
});

test('授权通过后处理器使用方案解析出的账号署名', async () => {
  const bucket = fakeBucket();
  const env = { USERS: authenticatedUsers({ github: 'octocat' }), UPLOAD_BUCKET: bucket };
  const response = await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '署名专辑' } }), env);
  const { ref } = await response.json();
  const status = JSON.parse(bucket.store.get(`workspace/${ref}/status.json`));
  assert.equal(status.owner, 'octocat');
});
