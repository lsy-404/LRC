import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const monacoPath = new URL('../docs/.vuepress/components/MonacoLrcEditor.vue', import.meta.url);

test('MonacoLrcEditor 的 lrc 语言注册随系统暗色主题切换', async () => {
  const source = await readFile(monacoPath, 'utf8');
  assert.match(source, /if \(!api\.languages\.getLanguages\(\)\.some\(\(language\) => language\.id === 'lrc'\)\) \{/);
  assert.match(source, /prefers-color-scheme: dark/);
});
