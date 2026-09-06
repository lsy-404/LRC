import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Monaco按需加载worker、注册LRC语言并在卸载时释放实例', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/MonacoLrcEditor.vue', import.meta.url), 'utf8');
  assert.match(source, /import\('monaco-editor'\)/);
  assert.match(source, /window\.MonacoEnvironment = \{ getWorker/);
  assert.match(source, /languages\.register\(\{ id: 'lrc'/);
  assert.match(source, /editor\?\.dispose\(\); model\?\.dispose\(\)/);
});
