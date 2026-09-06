import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasComponent, hasImport } from './helpers/vueSource.mjs';

const workspacePath = new URL('../docs/.vuepress/components/Workspace.vue', import.meta.url);
const workbenchPath = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

const read = (path) => readFile(path, 'utf8');

test('工作区壳组合上传与编辑视图', async () => {
  const source = await read(workspacePath);
  assert.ok(hasImport(source, 'WorkspaceExplorer', './WorkspaceExplorer.vue'));
  assert.ok(hasImport(source, 'WorkspaceTabs', './WorkspaceTabs.vue'));
  assert.ok(hasComponent(source, 'WorkspaceExplorer'));
  assert.ok(hasComponent(source, 'WorkspaceTabs'));
});

test('Explorer 文件点击可创建或激活可关闭的 Monaco 文件标签', async () => {
  const source = await read(workspacePath);
  assert.match(source, /documents/);
  assert.match(source, /function closeDocument\(/);
  assert.ok(hasComponent(source, 'TrackTextView'));
});

test('WorkBench 不直接持有上传/编辑页签，统一委托给工作区外壳', async () => {
  const source = await read(workbenchPath);
  assert.ok(hasComponent(source, 'Workspace'));
  assert.doesNotMatch(source, /(?:upload|edit|上传|编辑)[A-Za-z-]*(?:Page|Tab)|pageTabs|wb-tabs/i);
});
