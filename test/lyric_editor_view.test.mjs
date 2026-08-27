import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('空轨仍可进入时间轴编辑以新增首段', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /class="eb-btn small"\s*\n\s*:class="\{ on: t\._view === 'lrc' \}"/);
  assert.doesNotMatch(source, /v-if="t\.rows\.length"\s*\n\s*class="eb-btn small"/);
});
