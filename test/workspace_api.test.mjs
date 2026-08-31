import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/src/api.js';
import { fakeBucket, authedRequest } from './worker/_fakeR2.mjs';

const source = {
  slug: 'demo_album', folder: '示例专辑', name: '示例专辑', zh_name: '示例专辑', songs: [
    { title: '01 歌曲', lyrics: [{ time: 1.25, text: '第一句' }] },
  ], year: '2026', lyric_maker: ['制作人'], vocal: ['歌手'],
};

function assets() {
  return { fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/albums.json') return Response.json({ albums: [{ slug: source.slug, folder: source.folder, name: source.name, song_count: 1, detail_url: '/api/albums/demo_album.json' }] });
    if (path === '/api/albums/demo_album.json') return Response.json(source);
    return new Response('not found', { status: 404 });
  } };
}

function env(bucket = fakeBucket()) {
  return {
    UPLOAD_PASSWORD: 'pw', UPLOAD_BUCKET: bucket, ASSETS: assets(),
    JOB: { getByName: () => ({ fetch: async () => Response.json({ queued: true, state: 'queued' }) }) },
  };
}

test('workspace catalog is authenticated and sourced from static build output', async () => {
  const target = env();
  const denied = await handleApi(new Request('https://x/api/workspace/catalog'), target);
  assert.equal(denied.status, 401);
  const response = await handleApi(authedRequest('https://x/api/workspace/catalog'), target);
  assert.deepEqual(await response.json(), { albums: [{ slug: 'demo_album', folder: '示例专辑', name: '示例专辑', song_count: 1, detail_url: '/api/albums/demo_album.json' }] });
});

test('opening a published album only creates an isolated workspace draft', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const response = await handleApi(authedRequest('https://x/api/workspace/open', { method: 'POST', body: { slug: 'demo_album' } }), target);
  assert.equal(response.status, 200);
  const opened = await response.json();
  assert.match(opened.ref, /^[0-9a-f]{32}$/);
  assert.equal(opened.draft.source.kind, 'published');
  assert.equal(opened.draft.tracks[0].lrc, '[00:01.250]第一句\n');
  assert.equal(bucket.store.has(`workspace/${opened.ref}/draft.json`), true);
  assert.equal([...bucket.store.keys()].some((key) => key.startsWith('res/')), false);
  opened.draft.album = '已修改副本';
  const saved = await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: opened.ref, draft: opened.draft } }), target);
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(bucket.store.get(`workspace/${opened.ref}/draft.json`)).album, '已修改副本');
});

test('new LRC workspace rejects unsafe drafts and submits uploaded files through existing ingestion', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '新专辑' } }), target)).json();
  const bad = await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft: { album: '../escape', tracks: [] } } }), target);
  assert.equal(bad.status, 400);
  const lrc = await handleApi(authedRequest('https://x/api/workspace/lrc', { method: 'POST', body: { ref: created.ref, title: '新建歌词.lrc' } }), target);
  assert.equal(lrc.status, 200);
  assert.equal((await lrc.json()).track.title, '新建歌词.lrc');
  const savedDraft = JSON.parse(bucket.store.get(`workspace/${created.ref}/draft.json`));
  savedDraft.tracks[0].lrc = '[00:01.000]工作区修改后歌词\n';
  await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft: savedDraft } }), target);
  const unsafeFile = await handleApi(authedRequest('https://x/api/workspace/lrc', { method: 'POST', body: { ref: created.ref, title: '../escape.lrc' } }), target);
  assert.equal(unsafeFile.status, 400);
  await bucket.put(`web/${created.ref}/0`, 'audio');
  const response = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref, files: [{ n: 0, path: '01.mp3', size: 5 }] } }), target);
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${created.ref}/manifest.json`));
  assert.equal(manifest.album, '新专辑');
  assert.deepEqual(manifest.files, [
    { n: 0, path: '01.mp3', size: 5 },
    { n: 1, path: 'workspace/001 新建歌词.lrc', size: Buffer.byteLength('[00:01.000]工作区修改后歌词\n') },
  ]);
  assert.equal(bucket.store.get(`web/${created.ref}/1`), '[00:01.000]工作区修改后歌词\n');
  const duplicate = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref, files: [{ n: 0, path: '01.mp3', size: 5 }] } }), target);
  assert.equal(duplicate.status, 409);
});

test('saved LRC tracks can start extraction without a new binary upload', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '纯歌词专辑' } }), target)).json();
  await handleApi(authedRequest('https://x/api/workspace/lrc', { method: 'POST', body: { ref: created.ref, title: '唯一歌词' } }), target);
  const draft = JSON.parse(bucket.store.get(`workspace/${created.ref}/draft.json`));
  draft.tracks[0].lrc = '[00:00.000]无需上传音频\n';
  await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target);
  const response = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref, files: [] } }), target);
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${created.ref}/manifest.json`));
  assert.deepEqual(manifest.files, [{ n: 0, path: 'workspace/001 唯一歌词.lrc', size: Buffer.byteLength('[00:00.000]无需上传音频\n') }]);
});
