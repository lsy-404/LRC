import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('权威 LRC 在工作台保存时原样透传且不启用自动清理', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /:disabled="t\.authoritativeLrc" @click="simplifyTrack\(t\)"/);
  assert.match(source, /if \(t\.authoritativeLrc\) return;/);
  assert.match(source, /if \(t\.authoritativeLrc\) \{\s+return \{\s+\.\.\.t\._orig,/);
});
