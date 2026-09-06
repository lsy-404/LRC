import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/src/api.js';
import { fakeBucket, authedRequest, authenticatedUsers } from './worker/_fakeR2.mjs';

const source = {
  slug: 'demo_album', folder: '示例专辑', name: '示例专辑', zh_name: '示例专辑', songs: [
    { title: '01 歌曲', lyrics: [{ time: 1.25, text: '第一句', words: [{ time: 1.25, text: '第' }, { time: 1.4, text: '一句' }] }] },
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
    USERS: authenticatedUsers({ github: 'octocat' }),
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
  assert.equal(opened.draft.tracks[0].klrc, '[00:01.250]<00:01.250>第<00:01.400>一句\n');
  assert.equal(bucket.store.has(`workspace/${opened.ref}/draft.json`), true);
  assert.equal([...bucket.store.keys()].some((key) => key.startsWith('res/')), false);
  opened.draft.album = '已修改副本';
  const saved = await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: opened.ref, draft: opened.draft } }), target);
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(bucket.store.get(`workspace/${opened.ref}/draft.json`)).album, '已修改副本');
});

test('new LRC workspace rejects unsafe drafts and submits registered assets through existing ingestion', async () => {
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
  const registered = await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: '01.mp3', role: 'song', size: 5 } }), target);
  assert.equal(registered.status, 200);
  assert.deepEqual((await registered.json()).asset, { n: 0, path: '01.mp3', role: 'song', size: 5, linkTo: [] });
  const response = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target);
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${created.ref}/manifest.json`));
  assert.equal(manifest.album, '新专辑');
  assert.deepEqual(manifest.files.filter((file) => file.path !== 'manifest.toml'), [
    { n: 0, path: '01.mp3', size: 5 },
    { n: 1, path: '01.lrc', size: Buffer.byteLength('[00:01.000]工作区修改后歌词\n') },
  ]);
  assert.equal(bucket.store.get(`web/${created.ref}/1`), '[00:01.000]工作区修改后歌词\n');
  const duplicate = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target);
  assert.equal(duplicate.status, 200);
});

test('published word timings are submitted as an ELRC sidecar', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const opened = await (await handleApi(authedRequest('https://x/api/workspace/open', { method: 'POST', body: { slug: 'demo_album' } }), target)).json();
  const response = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: opened.ref } }), target);
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${opened.ref}/manifest.json`));
  assert.deepEqual(manifest.files.map(({ path }) => path), ['workspace/001 01 歌曲.lrc', 'workspace/001 01 歌曲.elrc', 'manifest.toml']);
  assert.equal(bucket.store.get(`web/${opened.ref}/1`), '[00:01.250]<00:01.250>第<00:01.400>一句\n');
});

test('saved LRC tracks can start extraction without a new binary upload', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '纯歌词专辑' } }), target)).json();
  await handleApi(authedRequest('https://x/api/workspace/lrc', { method: 'POST', body: { ref: created.ref, title: '唯一歌词' } }), target);
  const draft = JSON.parse(bucket.store.get(`workspace/${created.ref}/draft.json`));
  draft.tracks[0].lrc = '[00:00.000]无需上传音频\n';
  await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target);
  const response = await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target);
  assert.equal(response.status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${created.ref}/manifest.json`));
  assert.deepEqual(manifest.files.filter((file) => file.path !== 'manifest.toml'), [{ n: 0, path: 'workspace/001 唯一歌词.lrc', size: Buffer.byteLength('[00:00.000]无需上传音频\n') }]);
});

test('workspace asset registration verifies the uploaded object exists with a matching size', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '素材专辑' } }), target)).json();

  const unauthenticated = await handleApi(new Request('https://x/api/workspace/asset', { method: 'POST', body: JSON.stringify({ ref: created.ref, n: 0, path: 'a.jpg', role: 'photo', size: 3 }), headers: { 'content-type': 'application/json' } }), target);
  assert.equal(unauthenticated.status, 401);

  const missingUpload = await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: 'a.jpg', role: 'photo', size: 3 } }), target);
  assert.equal(missingUpload.status, 409);

  await bucket.put(`web/${created.ref}/0`, 'abc');
  const forgedSize = await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: 'a.jpg', role: 'photo', size: 999 } }), target);
  assert.equal(forgedSize.status, 409);

  const badRole = await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: 'a.jpg', role: 'nope', size: 3 } }), target);
  assert.equal(badRole.status, 400);

  const ok = await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: 'a.jpg', role: 'photo', size: 3, linkTo: [1, 'SP'] } }), target);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).asset, { n: 0, path: 'a.jpg', role: 'photo', size: 3, linkTo: [1, 'SP'] });
  const draft = JSON.parse(bucket.store.get(`workspace/${created.ref}/draft.json`));
  assert.deepEqual(draft.assets, [{ n: 0, path: 'a.jpg', role: 'photo', size: 3, linkTo: [1, 'SP'] }]);

  // 用同一个 n 重新登记会覆盖旧条目，而不是追加
  await bucket.put(`web/${created.ref}/0`, 'abcdef');
  const replaced = await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: 'b.jpg', role: 'cover', size: 6 } }), target);
  assert.equal(replaced.status, 200);
  const redraft = JSON.parse(bucket.store.get(`workspace/${created.ref}/draft.json`));
  assert.deepEqual(redraft.assets, [{ n: 0, path: 'b.jpg', role: 'cover', size: 6, linkTo: [] }]);
});

test('workspace audio streams only registered assets, requires auth, and supports Range', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: '试听专辑' } }), target)).json();
  await bucket.put(`web/${created.ref}/0`, 'abcdef');
  await handleApi(authedRequest('https://x/api/workspace/asset', { method: 'POST', body: { ref: created.ref, n: 0, path: '原曲.flac', role: 'song', size: 6 } }), target);

  const unauthenticated = await handleApi(new Request(`https://x/api/workspace/audio?ref=${created.ref}&n=0`), target);
  assert.equal(unauthenticated.status, 401);

  const full = await handleApi(authedRequest(`https://x/api/workspace/audio?ref=${created.ref}&n=0`), target);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/flac');
  assert.equal(await full.text(), 'abcdef');

  const ranged = await handleApi(new Request(`https://x/api/workspace/audio?ref=${created.ref}&n=0`, { headers: { cookie: 'lrc_session=test-session', range: 'bytes=2-4' } }), target);
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-4/6');
  assert.equal(await ranged.text(), 'cde');

  const unregistered = await handleApi(authedRequest(`https://x/api/workspace/audio?ref=${created.ref}&n=1`), target);
  assert.equal(unregistered.status, 404);
});

test('extract preserves edited lyrics as one audio-matched pair and replaces raw lyric inputs', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  target.REQUIRED_LYRIC_MAKER = 'Required';
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: 'Edited' } }), target)).json();
  const assets = [{ n: 0, path: 'audio/song.mp3', size: 5, role: 'song', linkTo: [] }, { n: 1, path: 'song.lrc', size: 3, role: 'text', linkTo: [] }, { n: 2, path: 'song.elrc', size: 3, role: 'text', linkTo: [] }];
  for (const asset of assets) await bucket.put(`web/${created.ref}/${asset.n}`, asset.n === 0 ? 'audio' : 'old');
  const draft = { ...created.draft, assets, tracks: [{ order: 1, title: 'Display title', audio: 'song.mp3', lrc: '[00:01.000]edited\n', klrc: '[00:01.000]<00:01.500>edited\n' }] };
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target)).status, 200);
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target)).status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${created.ref}/manifest.json`));
  assert.deepEqual(manifest.files.map((file) => file.path), ['audio/song.mp3', 'audio/song.lrc', 'audio/song.elrc', 'manifest.toml']);
  assert.deepEqual(manifest.lyric_maker, ['Editor', 'Required']);
  for (const file of manifest.files.filter((file) => /\.(?:lrc|elrc)$/.test(file.path))) {
    assert.match(bucket.store.get(`web/${created.ref}/${file.n}`), /edited/);
  }
});

test('untimed text is submitted as text and never as an empty authoritative LRC', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: 'Untimed' } }), target)).json();
  const draft = { ...created.draft, tracks: [{ order: 1, title: 'Song', lrc: '', klrc: '', lines: ['hello', 'world'], timing_locked: false }] };
  await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target);
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target)).status, 200);
  const manifest = JSON.parse(bucket.store.get(`web/${created.ref}/manifest.json`));
  assert.deepEqual(manifest.files.map((file) => file.path), ['workspace/001 Song.txt', 'manifest.toml']);
  assert.equal(bucket.store.get(`web/${created.ref}/${manifest.files[0].n}`), 'Song\n\nhello\nworld\n');
});

test('a lost job-start response can retry its immutable manifest while all edits stay locked', async () => {
  const bucket = fakeBucket(); const target = env(bucket);
  const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: 'Retry' } }), target)).json();
  const draft = { ...created.draft, tracks: [{ order: 1, title: 'Song', lrc: '[00:01.000]hello\n', klrc: '' }] };
  await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target);
  let attempts = 0;
  target.JOB = { getByName: () => ({ fetch: async () => { attempts++; if (attempts === 1) throw new Error('lost response'); return Response.json({ ok: true, already: true, state: 'running' }); } }) };
  const extract = () => handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target);
  assert.equal((await extract()).status, 502);
  const snapshot = bucket.store.get(`web/${created.ref}/manifest.json`);
  assert.equal((await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target)).status, 409);
  assert.equal((await extract()).status, 200);
  assert.equal(bucket.store.get(`web/${created.ref}/manifest.json`), snapshot);
  assert.equal(attempts, 2);
});

test('uploaded manifest and non-image cover are rejected before publishing submission', async () => {
  for (const [path, role] of [['manifest.toml', 'text'], ['not-image.txt', 'cover']]) {
    const bucket = fakeBucket(); const target = env(bucket);
    const created = await (await handleApi(authedRequest('https://x/api/workspace/create', { method: 'POST', body: { album: 'Invalid' } }), target)).json();
    await bucket.put(`web/${created.ref}/0`, 'raw');
    const draft = { ...created.draft, assets: [{ n: 0, path, role, size: 3, linkTo: [] }] };
    await handleApi(authedRequest('https://x/api/workspace/save', { method: 'POST', body: { ref: created.ref, draft } }), target);
    assert.equal((await handleApi(authedRequest('https://x/api/workspace/extract', { method: 'POST', body: { ref: created.ref } }), target)).status, 400);
    assert.equal(await bucket.head(`web/${created.ref}/manifest.json`), null);
  }
});
