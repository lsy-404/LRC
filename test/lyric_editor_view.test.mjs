import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const component = () => readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');

test('每张专辑只渲染当前选中轨，并在选择时读取该轨原音', async () => {
  const source = await component();
  assert.match(source, /v-model\.number="e\._selectedTrack"/);
  assert.match(source, /v-for="t in selectedTracks\(e\)"/);
  assert.match(source, /async function selectTrack\(e\)[\s\S]*?await loadAudio\(current\)/);
  assert.match(source, /for \(const edit of edits\.value\) await selectTrack\(edit\)/);
  assert.match(source, /node\.currentTime = \(Number\(t\._previewMs\) \|\| 0\) \/ 1000/);
  assert.doesNotMatch(source, /编辑歌词|听歌校对|eb-listen-stage/);
});

test('紧凑工作区同时提供认证原音播放器和逐字编辑', async () => {
  const source = await component();
  assert.match(source, /class="eb-workbench" aria-label="歌词校对工作区"/);
  assert.match(source, /class="eb-player" aria-label="原音播放器"/);
  assert.match(source, /@click="toggleSource\(t\)"/);
  assert.match(source, /@input="seekSource\(t, \$event\)"/);
  assert.match(source, /@click="simplifyTrack\(t\)"/);
  assert.match(source, /@click="addLine\(t, li\)"/);
  assert.match(source, /class="eb-word-timeline" aria-label="逐字时间轨"/);
  assert.match(source, /@pointerdown="startTimeDrag\(t, r, wi, \$event\)"/);
  assert.doesNotMatch(source, /v-model\.number="word\.time"/);
  assert.doesNotMatch(source, /v-model="word\.text"/);
  assert.match(source, /@click="retryAudio\(t\)">重试原音/);
});

test('播放高亮用索引和 requestAnimationFrame 同步，不在模板重复查找对象', async () => {
  const source = await component();
  assert.match(source, /requestAnimationFrame\(sync\)/);
  assert.match(source, /cancelAnimationFrame\(t\._sourceFrame\)/);
  assert.match(source, /li === t\._activeLine && wi === t\._activeWord/);
  assert.doesNotMatch(source, /rows\.indexOf|words\.indexOf/);
});

test('多专辑播放状态按曲目扁平管理，资源切换和状态转换统一释放', async () => {
  const source = await component();
  assert.match(source, /function allTracks\(\) \{ return edits\.value\.flatMap/);
  assert.match(source, /for \(const other of allTracks\(\)\) pausePreview\(other\)/);
  assert.match(source, /for \(const track of e\.tracks\) \{ if \(track !== current\) releaseAudio\(track\)/);
  assert.doesNotMatch(source.match(/async function selectTrack\(e\)[\s\S]*?\n}/)?.[0] || '', /allTracks\(\)/);
  assert.match(source, /t\._previewTimer = setInterval/);
  assert.match(source, /clearInterval\(t\._previewTimer\)/);
  assert.match(source, /releaseAllTracks\(\);\s*edits\.value = \[\]/);
  assert.match(source, /const controller = new AbortController\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(t\._audioAbort\) t\._audioAbort\.abort\(\)/);
  assert.match(source, /error\?\.name !== 'AbortError'/);
});

test('整行编辑保存逐字对象，提供光标拆分与选区移动', async () => {
  const source = await component();
  assert.match(source, /reconcileWordCharacters\(row\.words, row\.text, newId, row\.time\)/);
  assert.match(source, /@select="recordCursor\(r, \$event\)"/);
  assert.match(source, /@click="splitFromCursor\(t, r, li\)">从光标拆分/);
  assert.match(source, /@click="moveSelectionToNext\(t, r, li\)">选中移下一句/);
  assert.match(source, /utf16ToCodePointIndex\(row\.text, event\.target\.selectionStart\)/);
  assert.match(source, /function syncTrackText\(t\)/);
  assert.match(source, /@change="applyWholeText\(t\)"/);
});

test('时间轨提供慢速、边界菜单与受控拖动清理', async () => {
  const source = await component();
  assert.match(source, /const PLAYBACK_RATES = \[0\.1, 0\.25, 0\.5, 1, 1\.5, 2\]/);
  assert.match(source, /v-for="rate in PLAYBACK_RATES"/);
  assert.match(source, /contextmenu\.prevent\.stop="openTimelineMenu/);
  assert.match(source, /@contextmenu\.prevent\.stop="openTimelineMenu\(t, r, wi, 0, \$event\)"/);
  assert.match(source, /timelineMenu && timelineMenu\.rowId === r\._id/);
  assert.match(source, /position: fixed/);
  assert.match(source, /splitRowAtTokenBoundary\(menu\.t\.rows/);
  assert.match(source, /closeTimelineMenu/);
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /@lostpointercapture="finishTimeDrag\(\$event\)"/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /clearTimeDrag\(\)/);
  assert.match(source, /activeIndexAt\(t\.rows, ms\)/);
  assert.match(source, /now - lastUi >= 100/);
  assert.match(source, /setInterval\([\s\S]*?\}, 100\)/);
  assert.doesNotMatch(source, /function normalizeTrackWords|function syncWordText|function addWord|function removeWord/);
  assert.doesNotMatch(source, /flatMap\(\(r\) => \[Number\(r\.time\)/);
});
