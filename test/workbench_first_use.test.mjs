import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workbench = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

test('验证完成后直接进入统一文件工作区，不再显示页面级操作指引', async () => {
  const source = await readFile(workbench, 'utf8');
  assert.match(source, /<UnifiedWorkspace v-else/);
  assert.doesNotMatch(source, /wb-guide|role="dialog"|UploadBox|EditBox/);
});

test('已验证工作站仍可清除凭据并回到验证页', async () => {
  const source = await readFile(workbench, 'utf8');
  assert.match(source, /@click="logout">退出</);
  assert.match(source, /function logout\(\) \{ clearAuth\(\); password\.value = ''; pwInput\.value = ''; verified\.value = false;/);
});
