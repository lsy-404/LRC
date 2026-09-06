import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hasComponent } from './helpers/vueSource.mjs';

const workbench = new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url);

test('验证完成后直接进入工作区外壳，不再显示页面级操作指引', async () => {
  const source = await readFile(workbench, 'utf8');
  assert.ok(hasComponent(source, 'Workspace'));
  assert.doesNotMatch(source, /wb-guide|role="dialog"|UploadBox|EditBox/);
});
