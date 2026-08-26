// 工作站修改面板的四个接口：改存 R2 后的行为（原先落在 ingest-review 分支）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as listGet } from '../../functions/api/ingest/list.js';
import { onRequestGet as stateGet } from '../../functions/api/ingest/state.js';
import { onRequestPost as savePost } from '../../functions/api/ingest/save.js';
import { onRequestPost as discardPost } from '../../functions/api/ingest/discard.js';
import { onRequestPost as coverPost } from '../../functions/api/ingest/cover.js';
import { fakeBucket, authedRequest } from './_fakeR2.mjs';

const REF = 'a'.repeat(32);
const REF2 = 'b'.repeat(32);
const ALBUM = '再次呼唤我的名字吧';

function seeded() {
  return fakeBucket({
    [`review/${REF}/${ALBUM}/draft.json`]: JSON.stringify({ album: ALBUM, tracks: [{ title: '心跳' }] }),
    [`review/${REF}/${ALBUM}/stt.json`]: '{}',
    [`review/${REF}/${ALBUM}/status.json`]: JSON.stringify({
      phase: 'A_done', album: ALBUM, updated: '2026-08-01T00:00:00Z', contributor: 'web',
    }),
    [`review/${REF2}/溯流/draft.json`]: JSON.stringify({ album: '溯流', tracks: [] }),
    [`review/${REF2}/溯流/status.json`]: JSON.stringify({
      phase: 'A_done', album: '溯流', updated: '2026-08-02T00:00:00Z', is_update: true,
    }),
    [`web/${REF}/0`]: 'raw-payload',
  });
}

const envOf = (bucket, extra = {}) => ({
  UPLOAD_BUCKET: bucket, UPLOAD_PASSWORD: 'pw', ...extra,
});

test('list 枚举全部待处理草稿并按时间倒序', async () => {
  const env = envOf(seeded());
  const resp = await listGet({ request: authedRequest('https://x/api/ingest/list'), env });
  const data = await resp.json();
  assert.equal(data.pending.length, 2);
  assert.equal(data.pending[0].ref, REF2);
  assert.equal(data.pending[0].is_update, true);
  assert.equal(data.pending[1].album, ALBUM);
  assert.equal(data.pending[1].contributor, 'web');
});

test('list 拒绝无口令请求', async () => {
  const resp = await listGet({
    request: new Request('https://x/api/ingest/list'), env: envOf(seeded()),
  });
  assert.equal(resp.status, 401);
});

test('state 返回该 ref 的草稿', async () => {
  const env = envOf(seeded());
  const resp = await stateGet({ request: authedRequest(`https://x/s?ref=${REF}`), env });
  const data = await resp.json();
  assert.equal(data.status, 'ready');
  assert.equal(data.albums.length, 1);
  assert.equal(data.albums[0].album, ALBUM);
  assert.equal(data.albums[0].draft.tracks[0].title, '心跳');
});

test('state 对未产出草稿的 ref 报 processing', async () => {
  const env = envOf(seeded());
  const resp = await stateGet({ request: authedRequest(`https://x/s?ref=${'c'.repeat(32)}`), env });
  const data = await resp.json();
  assert.equal(data.status, 'processing');
  assert.deepEqual(data.albums, []);
});

test('state 透传处理作业阶段与进度', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.method, 'GET');
      return new Response(JSON.stringify({
        state: 'running', phase: 'phase_a', stage: 'downloading', progress: 23,
        message: '正在读取原料（2/9）',
      }), { status: 200 });
    };
    const resp = await stateGet({
      request: authedRequest(`https://x/s?ref=${'c'.repeat(32)}`),
      env: envOf(seeded(), { INGEST_TOKEN: 'token', INGEST_WORKER_URL: 'https://ingest.test' }),
    });
    const data = await resp.json();
    assert.equal(data.status, 'processing');
    assert.equal(data.job.stage, 'downloading');
    assert.equal(data.job.progress, 23);
  } finally {
    globalThis.fetch = orig;
  }
});

test('state 报出后台作业失败而不无限轮询', async () => {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      state: 'failed', phase: 'phase_a', error: '处理器不可用', stage: 'failed',
    }), { status: 200 });
    const resp = await stateGet({
      request: authedRequest(`https://x/s?ref=${'d'.repeat(32)}`),
      env: envOf(seeded(), { INGEST_TOKEN: 'token', INGEST_WORKER_URL: 'https://ingest.test' }),
    });
    const data = await resp.json();
    assert.equal(data.status, 'failed');
    assert.equal(data.job.error, '处理器不可用');
  } finally {
    globalThis.fetch = orig;
  }
});

test('state 拒绝非法 ref', async () => {
  const resp = await stateGet({ request: authedRequest('https://x/s?ref=..'), env: envOf(seeded()) });
  assert.equal(resp.status, 400);
});

test('save 覆盖草稿并刷新 status', async () => {
  const bucket = seeded();
  const env = envOf(bucket);
  const draft = { album: ALBUM, tracks: [{ title: '心跳', lines: ['改过的一行'] }] };
  const resp = await savePost({
    request: authedRequest('https://x/save', { method: 'POST', body: { ref: REF, album: ALBUM, draft } }),
    env,
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(JSON.parse(bucket.store.get(`review/${REF}/${ALBUM}/draft.json`)), draft);
  const st = JSON.parse(bucket.store.get(`review/${REF}/${ALBUM}/status.json`));
  assert.equal(st.edited, true);
  assert.notEqual(st.updated, '2026-08-01T00:00:00Z');
  assert.equal(st.contributor, 'web', 'status 其余字段应保留');
});

test('save 拒绝缺字段', async () => {
  const resp = await savePost({
    request: authedRequest('https://x/save', { method: 'POST', body: { ref: REF } }),
    env: envOf(seeded()),
  });
  assert.equal(resp.status, 400);
});

test('cover 写入 bundle 封面', async () => {
  const bucket = seeded();
  const req = new Request(`https://x/cover?ref=${REF}&album=${encodeURIComponent(ALBUM)}&ext=.jpg`, {
    method: 'POST',
    headers: { authorization: 'Bearer pw', 'content-length': '5' },
    body: 'bytes',
  });
  const resp = await coverPost({ request: req, env: envOf(bucket) });
  assert.equal(resp.status, 200);
  assert.equal(bucket.store.get(`review/${REF}/${ALBUM}/cover.jpg`), 'bytes');
});

test('cover 拒绝非法后缀', async () => {
  const req = new Request(`https://x/cover?ref=${REF}&album=x&ext=.exe.sh`, {
    method: 'POST',
    headers: { authorization: 'Bearer pw', 'content-length': '5' },
    body: 'bytes',
  });
  const resp = await coverPost({ request: req, env: envOf(seeded()) });
  assert.equal(resp.status, 400);
});

test('discard 删掉整张专辑的 bundle 且不碰原料', async () => {
  const bucket = seeded();
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    const env = envOf(bucket, { INGEST_WORKER_URL: 'https://w', INGEST_TOKEN: 't' });
    const resp = await discardPost({
      request: authedRequest('https://x/discard', { method: 'POST', body: { ref: REF, album: ALBUM } }),
      env,
    });
    const data = await resp.json();
    assert.equal(data.removed, 3);
    assert.equal(bucket.store.has(`web/${REF}/0`), true, '原料由生命周期规则清理，不在此删');
    // 该 ref 下已无草稿 → 撤掉超时闹钟
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://w/discard');
    assert.deepEqual(calls[0].body, { ref: REF });
  } finally {
    globalThis.fetch = orig;
  }
});

test('discard 找不到草稿时报 404 且不叫编排', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (...a) => { calls.push(a); return new Response('{}'); };
  try {
    const env = envOf(seeded(), { INGEST_WORKER_URL: 'https://w', INGEST_TOKEN: 't' });
    const resp = await discardPost({
      request: authedRequest('https://x/discard', { method: 'POST', body: { ref: REF, album: '不存在' } }),
      env,
    });
    assert.equal(resp.status, 404);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = orig;
  }
});
