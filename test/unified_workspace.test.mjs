import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorkspaceAdapter } from '../docs/.vuepress/components/workspaceAdapter.js';

const workspacePath = new URL('../docs/.vuepress/components/UnifiedWorkspace.vue', import.meta.url);
const workbenchPath = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

test('验证后只挂载单一文件工作区，而非上传修改页签', async () => {
  const source = await readFile(workbenchPath, 'utf8');
  assert.match(source, /<UnifiedWorkspace v-else/);
  assert.doesNotMatch(source, /UploadBox|EditBox|wb-tabs|tab ===/);
});

test('统一工作区通过同一 Monaco 模型承载新建、导入和已有专辑文件', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /新建 LRC/);
  assert.match(source, /导入文件/);
  assert.match(source, /meta\.json/);
  assert.match(source, /<MonacoLrcEditor v-model="selected\.content"/);
  assert.match(source, /自动提取并生成/);
  assert.doesNotMatch(source, /UploadBox|EditBox/);
});

test('工作区适配器只封装已存在的 ingest 服务边界', async () => {
  const calls = [];
  const adapter = createWorkspaceAdapter('pw', async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
  await adapter.state('a b'); await adapter.save('ref', 'album', { tracks: [] }); await adapter.generate('ref');
  assert.equal(calls[0][0], '/api/ingest/state?ref=a%20b');
  assert.equal(calls[1][0], '/api/ingest/save');
  assert.equal(calls[2][0], '/api/ingest/continue');
  assert.match(calls[1][1].headers.authorization, /^Bearer /);
});
