import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('轨道将编辑和听歌校对拆成顶层模式，空轨仍可进入逐字编辑', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /@click="openEdit\(t\)"\s*\n\s*>编辑歌词/);
  assert.match(source, /@click="openListen\(t\)"\s*\n\s*>听歌校对/);
  assert.match(source, /v-if="t\._mode === 'listen'" class="eb-listen"/);
  assert.match(source, /v-else-if="t\._view === 'lrc'" class="eb-lrc"/);
  assert.match(source, /@click="openListen\(t\)"/);
  assert.match(source, /@click="openEdit\(t\)"/);
  assert.match(source, /_mode: 'edit'/);
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
  assert.match(source, /v-if="\(!t\._audioUrl && !t\._audioLoading\) \|\| t\._audioErr" class="eb-preview eb-simulation"/);
  assert.match(source, /'暂停模拟' : '播放模拟'/);
  assert.match(source, /模拟只按歌词时间戳推进，不会播放音频/);
});

test('进入听歌校对按需自动读取原音，并使用自有播放器控制', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  assert.match(source, /async function openListen\(t\) \{ t\._mode = 'listen'; await loadAudio\(t\); \}/);
  assert.match(source, /function openEdit\(t\) \{ pauseSource\(t\); t\._mode = 'edit'; \}/);
  assert.match(source, /class="eb-player" aria-label="原音播放器"/);
  assert.match(source, /@click="toggleSource\(t\)"/);
  assert.match(source, /@input="seekSource\(t, \$event\)"/);
  assert.match(source, /@input="setVolume\(t\)"/);
  assert.match(source, /@change="setSourceRate\(t\)"/);
  assert.match(source, /class="eb-hidden-audio"/);
  assert.doesNotMatch(source, /\n\s+controls\n/);
  assert.match(source, /@click="retryAudio\(t\)">重试原音/);
});

test('切换编辑只暂停原音，隐藏音频不随听歌视图卸载', async () => {
  const source = await readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
  const listenStart = source.indexOf('<div v-if="t._mode === \'listen\'" class="eb-listen"');
  const editStart = source.indexOf('<div v-else-if="t._view === \'lrc\'" class="eb-lrc"');
  assert.ok(listenStart >= 0 && editStart > listenStart);
  assert.doesNotMatch(source.slice(listenStart, editStart), /<audio/);
  assert.match(source, /<div v-else class="eb-text-edit">[\s\S]*?<\/div>\s*<audio\s*\n\s*v-if="t\._audioUrl"/);
  assert.match(source, /function openEdit\(t\) \{ pauseSource\(t\); t\._mode = 'edit'; \}/);
});
