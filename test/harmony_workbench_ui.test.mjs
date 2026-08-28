import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('主唱和声在一个工作台中共用完整编辑交互', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  const workbench = source.match(/class="eb-workbench"[\s\S]*?<audio/)?.[0] || '';
  assert.equal((workbench.match(/class="eb-editor-panel"/g) || []).length, 1);
  assert.match(workbench, /v-for="\(vocal, vi\) in t\._vocals"/);
  assert.match(workbench, /:key="vocal\.id"/);
  assert.match(workbench, /class="eb-vocal-lane"/);
  assert.match(source, /主唱与和声图例/);
  assert.match(workbench, /@input="syncRowText\(vocal, r\); markHistory\(vocal\)"/);
  assert.match(workbench, /@pointerdown="startTimeDrag\(vocal, r, wi, \$event\)"/);
  assert.match(workbench, /@click="toggleHarmonyRow\(vocal, r\)"/);
  assert.match(workbench, /@click="addLine\(vocal, li\)"/);
  assert.match(workbench, /@click="removeLine\(vocal, li\)"/);
  assert.doesNotMatch(workbench, /eb-vocal-overlap|eb-vocal-bar|<select[^>]*声部/);
});
