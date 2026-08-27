import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('空轨仍可进入时间轴编辑以新增首段', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /class="eb-btn small"\s*\n\s*:class="\{ on: t\._view === 'lrc' \}"/);
  assert.doesNotMatch(source, /v-if="t\.rows\.length"\s*\n\s*class="eb-btn small"/);
});

test('审核原音通过认证 fetch 生成 Blob URL，且提供繁转简编辑入口', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /import OpenCC from 'opencc-js\/t2cn'/);
  assert.match(source, /fetch\(`\/api\/ingest\/audio\?\$\{q\}`, \{ headers: authHeaders\(\) \}\)/);
  assert.match(source, /URL\.createObjectURL\(await resp\.blob\(\)\)/);
  assert.match(source, /@click="simplifyTrack\(t\)"/);
  assert.match(source, /@timeupdate="sourceTime\(t, \$event\)"/);
  assert.match(source, /@error="sourceError\(t\)"/);
  assert.match(source, /无法播放该原始格式；可继续使用时间轴模拟校对/);
});
