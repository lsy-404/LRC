import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, fakeStudio } from './worker/_studio.mjs';
import { fakeBucket, authedRequest, authenticatedUsers } from './worker/_fakeR2.mjs';

// 编辑器侧的草稿往返由工作站方案自己的测试覆盖；这里验证宿主收到客户端保存的草稿后，嵌套文件与歌词能完整提取。
function setup(studio = fakeStudio()) {
  const bucket = fakeBucket();
  const env = {
    UPLOAD_BUCKET: bucket,
    USERS: authenticatedUsers(),
    JOB: { getByName: () => ({ fetch: async () => Response.json({ state: 'queued' }) }) },
  };
  const post = async (action, body) => {
    const response = await handleApi(authedRequest(`https://x/api/workspace/${action}`, { method: 'POST', body }), env, studio);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const readDraft = async (ref) => (await (await handleApi(authedRequest(`https://x/api/workspace/draft?ref=${ref}`), env, studio)).json()).draft;
  return { bucket, post, readDraft };
}

const elrc = '[00:01.000]<00:01.000>星<00:01.500>河\n';
const timed = (track, extra = {}) => ({ ...track, lrc: '[00:01.000]星河\n', klrc: elrc, lines: ['星河'], timing_locked: true, ...extra });

test('nested files and linked lyric edits survive save, reload and extraction', async () => {
  const { bucket, post, readDraft } = setup();
  const { ref } = await post('create', { album: '文件往返', submission_type: 'single' });
  await post('document', { ref, kind: 'folder', path: '歌词' });
  await post('document', { ref, kind: 'file', path: '歌词/星河.elrc' });
  await post('document', { ref, kind: 'file', path: '歌词/星河 INST.elrc' });
  await post('document', { ref, kind: 'file', path: '歌词/说明.json' });
  const initial = await readDraft(ref);
  const draft = {
    ...initial,
    tracks: [timed(initial.tracks[0]), timed(initial.tracks[1], { inst: true })],
    documents: initial.documents.map((item) => item.path === '歌词/说明.json' ? { ...item, text: '{"说明":"保存后继续修改"}\n' } : item),
  };
  await post('save', { ref, draft });

  const reloaded = await readDraft(ref);
  assert.equal(reloaded.submission_type, 'single');
  assert.deepEqual(reloaded.tracks.map((track) => track.lyric_stem), ['歌词/星河', '歌词/星河 INST']);
  for (const track of reloaded.tracks) {
    assert.equal(track.lrc, '[00:01.000]星河\n');
    assert.equal(track.klrc, elrc);
  }
  await post('extract', { ref });
  const manifest = JSON.parse(bucket.store.get(`web/${ref}/manifest.json`));
  const files = new Map(manifest.files.map((file) => [file.path, bucket.store.get(`web/${ref}/${file.n}`)]));
  assert.equal(files.get('歌词/说明.json'), '{"说明":"保存后继续修改"}\n');
  assert.equal(files.get('歌词/星河.elrc'), elrc);
  assert.equal(files.get('歌词/星河 INST.elrc'), elrc);
  assert.equal(files.get('歌词/星河.lrc'), '[00:01.000]星河\n');
  assert.equal(files.get('歌词/星河 INST.lrc'), '[00:01.000]星河\n');
  assert.equal([...files.keys()].some((path) => path.endsWith('.klrc')), false);
});

test('library-bound tracks and uploaded library audio become streamed manifest entries', async () => {
  const studio = fakeStudio({ songs: { 'so-1': { id: 'so-1', suffix: 'flac', size: 11 }, 'si-upload-2': { id: 'si-upload-2', suffix: 'wav', size: 22 } } });
  const { bucket, post, readDraft } = setup(studio);
  const { ref } = await post('create', { album: '曲库专辑' });
  const asset = await post('asset', { ref, n: 0, path: '02 第二首.wav', role: 'song', size: 20, linkTo: [2], library: { id: 'si-upload-2', path: 'LRC/曲库专辑/02 第二首.wav' } });
  assert.deepEqual(asset.asset.library, { id: 'si-upload-2', path: 'LRC/曲库专辑/02 第二首.wav' });
  const initial = await readDraft(ref);
  await post('save', { ref, draft: { ...initial, tracks: [
    { order: 1, title: '第一首', library_song: 'so-1', lines: ['你好'], lrc: '', klrc: '' },
    { order: 2, title: '第二首', library_song: 'si-upload-2', lines: ['再见'], lrc: '', klrc: '' },
  ] } });
  await post('extract', { ref });

  const manifest = JSON.parse(bucket.store.get(`web/${ref}/manifest.json`));
  assert.equal(manifest.subject, 'sub-1');
  const audio = manifest.files.filter((file) => file.library);
  assert.deepEqual(audio.map(({ path, size, library }) => ({ path, size, library })).sort((a, b) => a.path.localeCompare(b.path)), [
    { path: '01 第一首.flac', size: 11, library: 'so-1' },
    { path: '02 第二首.wav', size: 22, library: 'si-upload-2' },
  ]);
  for (const file of audio) assert.equal(bucket.store.has(`web/${ref}/${file.n}`), false);
  const toml = bucket.store.get(`web/${ref}/${manifest.files.find((file) => file.path === 'manifest.toml').n}`);
  assert.match(toml, /"01 第一首\.flac" = "song"/);
  assert.match(toml, /"02 第二首\.wav" = "song"/);
  assert.deepEqual(studio.calls.library.map(([kind, subject]) => [kind, subject]), [['song', 'sub-1'], ['song', 'sub-1']]);
});

test('extraction refuses library audio it cannot read as the submitter', async () => {
  const studio = fakeStudio();
  const bucket = fakeBucket();
  const env = { UPLOAD_BUCKET: bucket, USERS: authenticatedUsers(), JOB: { getByName: () => ({ fetch: async () => Response.json({ state: 'queued' }) }) } };
  const call = (action, body) => handleApi(authedRequest(`https://x/api/workspace/${action}`, { method: 'POST', body }), env, studio);
  const { ref } = await (await call('create', { album: '缺失曲库' })).json();
  const { draft } = await (await handleApi(authedRequest(`https://x/api/workspace/draft?ref=${ref}`), env, studio)).json();
  await call('save', { ref, draft: { ...draft, tracks: [{ order: 1, title: '第一首', library_song: 'so-missing', lines: ['你好'], lrc: '', klrc: '' }] } });
  const response = await call('extract', { ref });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'library song unavailable');
  assert.equal(bucket.store.has(`web/${ref}/manifest.json`), false);
});
