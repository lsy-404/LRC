import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspacePath = new URL('../docs/.vuepress/components/UnifiedWorkspace.vue', import.meta.url);
const workbenchPath = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

const read = (path) => readFile(path, 'utf8');

test('统一工作区保留上传与编辑视图组件，并在同一界面组合', async () => {
  const source = await read(workspacePath);
  assert.match(source, /import\s+UploadBox\s+from\s+['"]\.\/UploadBox\.vue['"]/);
  assert.match(source, /import\s+EditBox\s+from\s+['"]\.\/EditBox\.vue['"]/);
  assert.match(source, /<UploadBox\b/);
  assert.match(source, /<EditBox\b/);
});

test('右侧编辑区提供标签栏，上传与可视化标签始终持久挂载', async () => {
  const source = await read(workspacePath);
  assert.match(source, /role=["']tablist["']/);
  assert.match(source, /(?:上传|upload)/i);
  assert.match(source, /(?:可视化|visual)/i);
  assert.match(source, /v-show\s*=\s*["'][^"']*(?:upload|上传)/i);
  assert.match(source, /v-show\s*=\s*["'][^"']*(?:visual|可视化)/i);
  assert.doesNotMatch(source, /v-if\s*=\s*["'][^"']*(?:upload|上传|visual|可视化)/i);
});

test('Explorer 文件点击创建或激活可关闭的 Monaco 文件标签', async () => {
  const source = await read(workspacePath);
  assert.match(source, /(?:open|activate|select)[A-Za-z]*FileTab|fileTabs/);
  assert.match(source, /(?:close|remove)[A-Za-z]*FileTab|closeTab/);
  assert.match(source, /MonacoLrcEditor/);
  assert.match(source, /@click=["'][^"']*(?:open|activate|select)[^"']*["']/);
});

test('WorkBench 不再提供顶层上传/编辑 page tabs', async () => {
  const source = await read(workbenchPath);
  assert.match(source, /<UnifiedWorkspace\b/);
  assert.doesNotMatch(source, /(?:upload|edit|上传|编辑)[A-Za-z-]*(?:Page|Tab)|pageTabs|wb-tabs/i);
});

test('统一工作区的左右滚动边界和 flex/grid 子项高度明确', async () => {
  const source = await read(workspacePath);
  assert.match(source, /\.uw-shell[^}]*overflow\s*:\s*hidden/);
  assert.match(source, /\.uw-shell[^}]*height\s*:/);
  assert.match(source, /\.uw-explorer[^}]*overflow-y\s*:\s*auto/);
  assert.match(source, /\.uw-editor[^}]*overflow\s*:\s*hidden/);
  assert.match(source, /\.uw-tab-panel[^}]*overflow-y\s*:\s*auto/);
  assert.match(source, /\.uw-tab-panel[^}]*min-height\s*:\s*0/);
});
