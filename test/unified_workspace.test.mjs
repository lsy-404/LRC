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

test('统一工作区保留上传、可视化编辑和可关闭的文件标签', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /<UploadBox :password="password" :theme="theme" \/>/);
  assert.match(source, /<EditBox :password="password" :theme="theme" \/>/);
  assert.match(source, /v-show="activeTab === 'upload'"/);
  assert.match(source, /v-show="activeTab === 'edit'"/);
  assert.match(source, /v-for="file in fileTabs"/);
  assert.match(source, /closeFile\(file\.id\)/);
  assert.match(source, /activeTab\.value = file\.id/);
});

test('统一工作区通过 Monaco 文件标签承载新建、导入和已有专辑文件', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /新建 LRC/);
  assert.match(source, /导入文件/);
  assert.match(source, /meta\.json/);
  assert.match(source, /<MonacoLrcEditor v-model="activeFile\.content"/);
  assert.match(source, /自动提取并生成/);
  assert.match(source, /if \(!fileTabs\.value\.some\(\(tab\) => tab\.id === file\.id\)\) fileTabs\.value\.push\(file\)/);
});

test('统一工作区的左右区域独立滚动，文件编辑器占满右侧', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /\.uw-shell \{[^}]*overflow:hidden/);
  assert.match(source, /\.uw-explorer \{[^}]*overflow-y:auto/);
  assert.match(source, /\.uw-editor \{[^}]*overflow:hidden/);
  assert.match(source, /\.uw-tab-panel \{ min-height:0; overflow-y:auto/);
  assert.match(source, /\.uw-file-panel :deep\(\.monaco-lrc-editor\) \{ flex:1; min-height:0/);
});

test('自动提取先保存当前工作区文件，并上传 Monaco 中的文本内容', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /if \(activeFile\.value\?\.remote && !\(await save\(\)\)\) return;/);
  assert.match(source, /new File\(\[file\.content\], file\.name, \{ type: file\.raw\.type \|\| 'text\/plain' \}\)/);
  assert.match(source, /size: uploadFile\.size/);
  assert.match(source, /: file\.raw;/);
});

test('已有 LRC 工作草稿即使没有待上传文件也能触发自动提取', async () => {
  const source = await readFile(workspacePath, 'utf8');
  assert.match(source, /:disabled="generating \|\| !canGenerate"/);
  assert.match(source, /const canGenerate = computed\(\(\) => localFiles\.value\.length > 0 \|\| workspaces\.value\.some\(\(workspace\) => workspace\.draft\.tracks\?\.length > 0\)\)/);
  assert.doesNotMatch(source, /:disabled="generating \|\| !localFiles\.length"/);
});

test('工作区适配器只调用正式 workspace 与 R2 上传边界', async () => {
  const calls = [];
  const adapter = createWorkspaceAdapter('pw', async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
  await adapter.catalog(); await adapter.list(); await adapter.draft('a b'); await adapter.create('专辑');
  await adapter.open('album'); await adapter.lrc('ref', '歌词.lrc'); await adapter.save('ref', { album: '专辑', tracks: [] });
  await adapter.upload('ref', 0, new Blob(['audio'], { type: 'audio/mpeg' })); await adapter.extract('ref', [{ n: 0, path: '01.mp3', size: 5 }]);
  assert.deepEqual(calls.map(([url]) => url), [
    '/api/workspace/catalog', '/api/workspace/list', '/api/workspace/draft?ref=a%20b', '/api/workspace/create',
    '/api/workspace/open', '/api/workspace/lrc', '/api/workspace/save', '/api/upload/r2?session=ref&n=0', '/api/workspace/extract',
  ]);
  assert.match(calls[7][1].headers.authorization, /^Bearer /);
});
