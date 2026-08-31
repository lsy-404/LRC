import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readComponent = (name) => readFile(new URL(`../docs/.vuepress/components/${name}`, import.meta.url), 'utf8');

test('工作站主题支持系统默认、持久化选择和可访问切换', async () => {
  const source = await readComponent('Workbench.vue');
  assert.match(source, /const THEME_KEY = 'lrc-workstation-theme'/);
  assert.match(source, /const themePreference = ref\('system'\)/);
  assert.match(source, /window\.matchMedia\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(source, /localStorage\.getItem\(THEME_KEY\)/);
  assert.match(source, /localStorage\.setItem\(THEME_KEY, value\)/);
  assert.match(source, /<label for="wb-theme">主题<\/label>/);
  assert.match(source, /<select id="wb-theme" v-model="themePreference" class="wb-theme-select" aria-label="工作站主题">/);
  assert.match(source, /<option value="system">跟随系统<\/option>/);
  assert.match(source, /<option value="dark">暗色<\/option>/);
  assert.match(source, /:data-theme="resolvedTheme"/);
  assert.match(source, /\.wb\[data-theme='dark'\]/);
  assert.match(source, /--wb-surface: #161b22/);
  assert.match(source, /color-scheme: dark/);
});

test('审核编辑器将显式工作站主题传递给 Monaco，并在变更时立即应用', async () => {
  const [workbench, upload, editor, monaco] = await Promise.all([
    readComponent('Workbench.vue'), readComponent('UploadBox.vue'), readComponent('EditBox.vue'), readComponent('MonacoLrcEditor.vue'),
  ]);
  assert.match(workbench, /<UploadBox v-show="tab === 'upload'" :password="password" :theme="resolvedTheme"/);
  assert.match(upload, /theme: \{ type: String, default: '' \}/);
  assert.match(workbench, /<EditBox v-show="tab === 'edit'" :password="password" :theme="resolvedTheme"/);
  assert.match(editor, /theme: \{ type: String, default: '' \}/);
  assert.match(editor, /<MonacoLrcEditor v-model="t\._sourceText" language="lrc" :theme="props\.theme"/);
  assert.match(monaco, /theme: \{ type: String, default: '' \}/);
  assert.match(monaco, /props\.theme === 'dark' \|\| \(!props\.theme && media\?\.matches\)/);
  assert.match(monaco, /watch\(\(\) => props\.theme, applyTheme\)/);
});
