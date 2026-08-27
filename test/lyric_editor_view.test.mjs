import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('轨道将编辑和听歌校对拆成顶层模式，空轨仍可进入逐字编辑', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /@click="t\._mode = 'edit'"\s*\n\s*>编辑歌词/);
  assert.match(source, /@click="t\._mode = 'listen'"\s*\n\s*>听歌校对/);
  assert.match(source, /v-if="t\._mode === 'listen'" class="eb-listen"/);
  assert.match(source, /v-else-if="t\._view === 'lrc'" class="eb-lrc"/);
  assert.match(source, /_mode: t\.audio \? 'listen' : 'edit'/);
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

test('听歌校对只读展示逐行逐字高亮，原音不可用时提供模拟', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /class="eb-listen-stage"/);
  assert.match(source, /class="eb-listen-line"/);
  assert.match(source, /isCurrentWord\(t, r, word\)/);
  assert.match(source, /v-if="!t\._audioUrl \|\| t\._audioErr" class="eb-preview eb-simulation"/);
  assert.match(source, /'暂停模拟' : '播放模拟'/);
  assert.match(source, /模拟只按歌词时间戳推进，不会播放音频/);
});
