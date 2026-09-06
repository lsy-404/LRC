import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hasComponent, hasProp } from './helpers/vueSource.mjs';

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
  assert.match(source, /--bg-color:#111113/);
  assert.match(source, /color-scheme: dark/);
});

test('工作区外壳接收主题并转交给 Monaco 文件编辑器，Monaco 按主题切换配色', async () => {
  const [workbench, workspace, monaco] = await Promise.all([
    readComponent('Workbench.vue'), readComponent('Workspace.vue'), readComponent('MonacoLrcEditor.vue'),
  ]);
  assert.ok(hasComponent(workbench, 'Workspace'));
  assert.ok(hasProp(workspace, 'theme'));
  assert.ok(hasProp(monaco, 'theme'));
  assert.match(monaco, /props\.theme === 'dark' \|\| \(!props\.theme && media\?\.matches\)/);
  assert.match(monaco, /watch\(\(\) => props\.theme, applyTheme\)/);
});
