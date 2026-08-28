// 工作站修改面板的四个接口：改存 R2 后的行为（原先落在 ingest-review 分支）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as listGet } from '../../functions/api/ingest/list.js';
import { onRequestGet as stateGet } from '../../functions/api/ingest/state.js';
import { onRequestPost as savePost } from '../../functions/api/ingest/save.js';
import { onRequestPost as discardPost } from '../../functions/api/ingest/discard.js';
import { onRequestPost as coverPost } from '../../functions/api/ingest/cover.js';
import { onRequestPost as retryPost } from '../../functions/api/ingest/retry.js';
import { fakeBucket, authedRequest } from './_fakeR2.mjs';

const REF = 'a'.repeat(32);
const REF2 = 'b'.repeat(32);
const ALBUM = '测试专辑';

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

test('list 从上传 manifest 发现尚未生成 review 草稿的投稿并透传作业状态', async () => {
  const ref = 'c'.repeat(32);
  const env = envOf(fakeBucket({
    [`web/${ref}/manifest.json`]: JSON.stringify({ album: '上传中专辑', contributor: 'web' }),
  }), { INGEST_INTERNAL_CALL: async (path, _body, method) => {
    assert.equal(method, 'GET');
    assert.equal(path, `/state?ref=${ref}`);
    return { ok: true, status: 200, data: {
      state: 'running', phase: 'phase_a', stage: 'writing_review', progress: 62, message: '正在写入审核草稿',
    } };
  } });
  const resp = await listGet({ request: authedRequest('https://x/api/ingest/list'), env });
  const item = (await resp.json()).pending.find((entry) => entry.ref === ref);
  assert.deepEqual(item, {
    ref, album: '上传中专辑', status: 'processing', state: 'running', stage: 'writing_review', progress: 62,
    storage_album: '上传中专辑',
    message: '正在写入审核草稿', updated: '', contributor: 'web', is_update: false,
  });
});

test('list 过滤已使用、已完成和未知状态的旧 manifest', async () => {
  const used = 'c'.repeat(32);
  const done = 'd'.repeat(32);
  const unknown = 'e'.repeat(32);
  const env = envOf(fakeBucket({
    [`web/${used}/manifest.json`]: JSON.stringify({ album: '已使用' }),
    [`web/${used}/.used`]: '1',
    [`web/${done}/manifest.json`]: JSON.stringify({ album: '已完成' }),
    [`web/${unknown}/manifest.json`]: JSON.stringify({ album: '未知' }),
  }), { INGEST_INTERNAL_CALL: async (path) => {
    const ref = new URL(`https://x${path}`).searchParams.get('ref');
    if (ref === done) return { ok: true, status: 200, data: { state: 'done', phase: 'phase_a' } };
    return { ok: true, status: 200, data: { state: 'unknown' } };
  } });
  const resp = await listGet({ request: authedRequest('https://x/api/ingest/list'), env });
  assert.equal((await resp.json()).pending.some((entry) => [used, done, unknown].includes(entry.ref)), false);
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
  assert.equal(data.albums[0].storage_album, ALBUM);
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
  const resp = await stateGet({
    request: authedRequest(`https://x/s?ref=${'c'.repeat(32)}`),
    env: envOf(seeded(), { INGEST_INTERNAL_CALL: async (_path, _body, method) => {
      assert.equal(method, 'GET');
      return { ok: true, status: 200, data: {
        state: 'running', phase: 'phase_a', stage: 'downloading', progress: 23,
        message: '正在读取原料（2/9）',
      } };
    } }),
  });
  const data = await resp.json();
  assert.equal(data.status, 'processing');
  assert.equal(data.job.stage, 'downloading');
  assert.equal(data.job.progress, 23);
});

test('state 报出后台作业失败而不无限轮询', async () => {
  const resp = await stateGet({
    request: authedRequest(`https://x/s?ref=${'d'.repeat(32)}`),
    env: envOf(seeded(), { INGEST_INTERNAL_CALL: async () => ({ ok: true, status: 200, data: {
      state: 'failed', phase: 'phase_a', error: '处理器不可用', stage: 'failed',
    } }) }),
  });
  const data = await resp.json();
  assert.equal(data.status, 'failed');
  assert.equal(data.job.error, '处理器不可用');
});

test('retry 使用已有 ref 重新排队而不读写原料', async () => {
  const calls = [];
  const bucket = seeded();
  const resp = await retryPost({
    request: authedRequest('https://x/retry', { method: 'POST', body: { ref: REF } }),
    env: envOf(bucket, { INGEST_INTERNAL_CALL: async (path, body) => {
      calls.push({ path, body });
      return { ok: true, status: 200, data: { ok: true, queued: true, phase: 'phase_a' } };
    } }),
  });
  const data = await resp.json();
  assert.equal(data.ok, true);
  assert.deepEqual(calls, [{ path: '/ingest', body: { ref: REF } }]);
  assert.equal(bucket.store.get(`web/${REF}/0`), 'raw-payload');
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

test('save 保留手工时间轴锁定字段', async () => {
  const bucket = seeded();
  const draft = { album: ALBUM, tracks: [{ title: '心跳', timing_locked: true, lrc: '[00:01.000]词\n', klrc: '[00:01.000]<00:01.000>词\n' }] };
  const resp = await savePost({ request: authedRequest('https://x/save', { method: 'POST', body: { ref: REF, album: ALBUM, draft } }), env: envOf(bucket) });
  assert.equal(resp.status, 200);
  assert.equal(JSON.parse(bucket.store.get(`review/${REF}/${ALBUM}/draft.json`)).tracks[0].timing_locked, true);
});

test('save 拒绝缺字段', async () => {
  const resp = await savePost({
    request: authedRequest('https://x/save', { method: 'POST', body: { ref: REF } }),
    env: envOf(seeded()),
  });
  assert.equal(resp.status, 400);
});

test('save 用原审核目录定位，同时保留已改的专辑输出名', async () => {
  const bucket = seeded();
  const renamed = '新专辑';
  const draft = { album: renamed, tracks: [{ title: '心跳' }] };
  const resp = await savePost({
    request: authedRequest('https://x/save', { method: 'POST', body: { ref: REF, album: ALBUM, draft } }),
    env: envOf(bucket),
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(JSON.parse(bucket.store.get(`review/${REF}/${ALBUM}/draft.json`)), draft);
  assert.equal(bucket.store.has(`review/${REF}/${renamed}/draft.json`), false);
});

test('list 和 state 使用草稿显示名，同时返回不可变存储名', async () => {
  const bucket = seeded();
  const renamed = '李宗盛';
  bucket.store.set(`review/${REF}/${ALBUM}/draft.json`, JSON.stringify({ album: renamed, tracks: [] }));
  const env = envOf(bucket);
  const listResp = await listGet({ request: authedRequest('https://x/api/ingest/list'), env });
  const listItem = (await listResp.json()).pending.find((item) => item.ref === REF);
  assert.equal(listItem.album, renamed);
  assert.equal(listItem.storage_album, ALBUM);
  const stateResp = await stateGet({ request: authedRequest(`https://x/s?ref=${REF}`), env });
  const stateItem = (await stateResp.json()).albums[0];
  assert.equal(stateItem.album, renamed);
  assert.equal(stateItem.storage_album, ALBUM);
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
  const env = envOf(bucket, { INGEST_INTERNAL_CALL: async (path, body) => {
    calls.push({ path, body });
    return { ok: true, status: 200, data: { ok: true } };
  } });
  const resp = await discardPost({
    request: authedRequest('https://x/discard', { method: 'POST', body: { ref: REF, album: ALBUM } }),
    env,
  });
  const data = await resp.json();
  assert.equal(data.removed, 3);
  assert.equal(bucket.store.has(`web/${REF}/0`), true, '原料由生命周期规则清理，不在此删');
  // 该 ref 下已无草稿 → 撤掉超时闸门
  assert.deepEqual(calls, [{ path: '/discard', body: { ref: REF } }]);
});

test('discard 找不到草稿时报 404 且不叫编排', async () => {
  const calls = [];
  const env = envOf(seeded(), { INGEST_INTERNAL_CALL: async (...args) => { calls.push(args); } });
  const resp = await discardPost({
    request: authedRequest('https://x/discard', { method: 'POST', body: { ref: REF, album: '不存在' } }),
    env,
  });
  assert.equal(resp.status, 404);
  assert.equal(calls.length, 0);
});
