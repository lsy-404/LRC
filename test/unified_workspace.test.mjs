import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkspaceAdapter } from '../docs/.vuepress/components/workspaceAdapter.js';
import { hasComponent } from './helpers/vueSource.mjs';

const workspacePath = new URL('../docs/.vuepress/components/Workspace.vue', import.meta.url);
const workbenchPath = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

test('Workbench 验证通过后只挂载单一工作区外壳，不直接持有上传/编辑页签', async () => {
  const source = await readFile(workbenchPath, 'utf8');
  assert.ok(hasComponent(source, 'Workspace'));
  assert.doesNotMatch(source, /UploadBox|EditBox/);
});

test('工作区通过可关闭的文件标签承载新建、导入和已有专辑文件', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.ok(hasComponent(source, 'WorkspaceExplorer'));
  assert.ok(hasComponent(source, 'WorkspaceTabs'));
  assert.ok(hasComponent(source, 'TrackTextView'));
  assert.match(source, /function closeDocument\(/);
});

test('自动提取会先落盘当前工作区文件的未保存修改，再把编辑内容作为上传素材', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /async function saveActive\(/);
  assert.match(source, /await uploadPending\(entry\)/);
});



test('工作区适配器只调用正式 workspace 与 R2 上传边界', async () => {
  const calls = [];
  const adapter = createWorkspaceAdapter(async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
  await adapter.catalog(); await adapter.list(); await adapter.draft('a b'); await adapter.create('专辑');
  await adapter.open('album'); await adapter.lrc('ref', '歌词.lrc'); await adapter.save('ref', { album: '专辑', tracks: [] });
  await adapter.upload('ref', 0, new Blob(['audio'], { type: 'audio/mpeg' }));
  await adapter.asset('ref', { n: 0, path: '01.mp3', role: 'song', size: 5, linkTo: [] });
  await adapter.extract('ref');
  assert.deepEqual(calls.map(([url]) => url), [
    '/api/workspace/catalog', '/api/workspace/list', '/api/workspace/draft?ref=a%20b', '/api/workspace/create',
    '/api/workspace/open', '/api/workspace/lrc', '/api/workspace/save', '/api/upload/r2?session=ref&n=0',
    '/api/workspace/asset', '/api/workspace/extract',
  ]);
  assert.equal(calls[7][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[8][1].body), { ref: 'ref', n: 0, path: '01.mp3', role: 'song', size: 5, linkTo: [] });
  // extract 只带 ref：素材清单以服务端草稿为准，不再由前端复述
  assert.deepEqual(JSON.parse(calls[9][1].body), { ref: 'ref' });
});



test('工作区适配器同一边界收拢待修改审核面板的 ingest 通道', async () => {
  const calls = [];
  const adapter = createWorkspaceAdapter(async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ ok: true, pending: [] }), { status: 200 }); });
  await adapter.pending();
  await adapter.state('ref1');
  await adapter.saveReview('ref1', 'album1', { album: '专辑', tracks: [] });
  await adapter.continue('ref1');
  await adapter.retry('ref1');
  await adapter.cover('ref1', 'album1', '.png', new Blob(['x'], { type: 'image/png' }));
  assert.deepEqual(calls.map(([url]) => url), [
    '/api/ingest/list', '/api/ingest/state?ref=ref1', '/api/ingest/save', '/api/ingest/continue', '/api/ingest/retry',
    '/api/ingest/cover?ref=ref1&album=album1&ext=.png',
  ]);
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[2][1].body), { ref: 'ref1', album: 'album1', draft: { album: '专辑', tracks: [] } });
  assert.deepEqual(JSON.parse(calls[3][1].body), { ref: 'ref1' });
});

test('工作区适配器 discard：404 视为草稿已不存在，按丢弃成功处理', async () => {
  const adapter = createWorkspaceAdapter(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 }));
  const result = await adapter.discard('ref1', 'album1');
  assert.equal(result.ok, true);
});

test('工作区适配器 discard：非 404 的失败仍然抛出', async () => {
  const adapter = createWorkspaceAdapter(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
  await assert.rejects(() => adapter.discard('ref1', 'album1'), /unauthorized/);
});

test('工作区适配器 audio：返回原始流式响应（不做 json 解析），供调用方读取 status/body', async () => {
  let captured;
  const fakeResponse = new Response(new Blob(['bytes']), { status: 206 });
  const adapter = createWorkspaceAdapter(async (url, init) => { captured = { url, init }; return fakeResponse; });
  const controller = new AbortController();
  const resp = await adapter.audio('ref1', '01.mp3', controller.signal);
  assert.equal(resp, fakeResponse);
  assert.equal(captured.url, '/api/ingest/audio?ref=ref1&name=01.mp3');
  assert.equal(captured.init.credentials, 'same-origin');
  assert.equal(captured.init.signal, controller.signal);
});

test('工作区适配器：HTTP 失败时抛出的 Error 携带 status，供调用方区分 401/404 等特例', async () => {
  const adapter = createWorkspaceAdapter(async () => new Response(JSON.stringify({ error: '登录已失效' }), { status: 401 }));
  try {
    await adapter.state('ref1');
    assert.fail('应抛出异常');
  } catch (error) {
    assert.equal(error.status, 401);
    assert.match(error.message, /登录已失效/);
  }
});
