import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const component = () => readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
const uploadComponent = () => readFile(new URL('../docs/.vuepress/components/UploadBox.vue', import.meta.url), 'utf8');
const workbenchComponent = () => readFile(new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url), 'utf8');

test('每张专辑只渲染当前选中轨，并在选择时读取该轨原音', async () => {
  const source = await component();
  assert.match(source, /v-model\.number="e\._selectedTrack"/);
  assert.match(source, /v-for="t in selectedTracks\(e\)"/);
  assert.match(source, /async function selectTrack\(e\)[\s\S]*?await loadAudio\(current\)/);
  assert.match(source, /for \(const edit of edits\.value\) await selectTrack\(edit\)/);
  assert.match(source, /node\.currentTime = playheadMs\(t\) \/ 1000/);
  assert.doesNotMatch(source, /编辑歌词|听歌校对|eb-listen-stage/);
});

test('播放器内联于歌词编辑区，且不保留原音与模拟说明', async () => {
  const source = await component();
  assert.match(source, /class="eb-workbench" aria-label="歌词校对工作区"/);
  assert.match(source, /class="eb-editor-panel">\s*<div class="eb-inline-player">/);
  assert.match(source, /class="eb-player" aria-label="播放器"/);
  assert.match(source, /@click="toggleSource\(t\)"/);
  assert.match(source, /@input="seekSource\(t, \$event\)"/);
  assert.match(source, /@click="simplifyTrack\(t\)"/);
  assert.match(source, /@click="addLine\(t, li\)"/);
  assert.match(source, /class="eb-word-timeline" role="region" aria-label="逐字时间轨"/);
  assert.match(source, /class="eb-time-track"/);
  assert.match(source, /eb-time-token-lower/);
  assert.match(source, /timedTokenFlexWeight\(row\.words/);
  assert.match(source, /--eb-time-grow/);
  assert.match(source, /flex: var\(--eb-time-grow, 1\) 1 max-content/);
  assert.match(source, /min-width: max-content/);
  assert.match(source, /timelineTokenStyle\(t, r, li, wi\)/);
  assert.match(source, /expandTimedTokens\(words, newId, 100, Number\(parsedRows\[index \+ 1\]\?\.time\)\)/);
  assert.match(source, /@pointerdown="startTimeDrag\(t, r, wi, \$event\)"/);
  assert.doesNotMatch(source, /v-model\.number="word\.time"/);
  assert.doesNotMatch(source, /v-model="word\.text"/);
  assert.match(source, /@click="retryAudio\(t\)">重试/);
  assert.doesNotMatch(source, /eb-player-panel|grid-template-columns: minmax\(15rem, 22rem\)/);
  assert.doesNotMatch(source, /原音只在审核期|时间轴模拟|此轨没有可读取的原音|模拟只按歌词时间戳/);
});

test('工作站与上传面板不保留解释性副标题', async () => {
  const [editor, upload, workbench] = await Promise.all([component(), uploadComponent(), workbenchComponent()]);
  assert.doesNotMatch(editor, /上方点选即可|列表字段多个用|最终写盘 LRC|修复后会复用|请先保存各专辑修改/);
  assert.doesNotMatch(upload, /作为投递文件夹名|支持歌词文本或|拖到曲目关联|已存本机。稍后到|自动 OCR/);
  assert.doesNotMatch(workbench, /凭邀请密码进入工作站/);
});

test('播放高亮在非响应式 DOM 映射中同步，不触发长歌词父组件重渲染', async () => {
  const source = await component();
  assert.match(source, /SOURCE_CURSOR_INTERVAL_MS = 40/);
  assert.match(source, /t\._sourceTimer = setInterval\(sync, SOURCE_CURSOR_INTERVAL_MS\)/);
  assert.match(source, /clearInterval\(t\._sourceTimer\)/);
  assert.doesNotMatch(source, /requestAnimationFrame\(sync\)|_sourceFrame/);
  assert.match(source, /bindLineNode\(t, li, node\)/);
  assert.match(source, /bindTokenNode\(t, li, wi, node\)/);
  assert.match(source, /const playbackViews = new WeakMap\(\)/);
  assert.match(source, /nextLine\?\.classList\.add\('active'\)/);
  assert.match(source, /nextToken\?\.classList\.add\('active'\)/);
  assert.doesNotMatch(source, /_activeLine|_activeWord/);
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
  assert.match(source, /mergeTimedRows\(menu\.t\.rows, menu\.rowIndex\)/);
  assert.match(source, /closeTimelineMenu/);
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /@lostpointercapture="finishTimeDrag\(\$event\)"/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /clearTimeDrag\(\)/);
  assert.match(source, /activeIndexAt\(t\.rows, ms\)/);
  assert.match(source, /SOURCE_PROGRESS_INTERVAL_MS = 80/);
  assert.match(source, /now - lastProgress >= SOURCE_PROGRESS_INTERVAL_MS/);
  assert.match(source, /setInterval\([\s\S]*?\}, 100\)/);
  assert.match(source, /const playheads = new WeakMap\(\)/);
  assert.match(source, /function updatePlaybackDom\(t\)/);
  assert.match(source, /tabindex="0"/);
  assert.match(source, /openTimelineMenuFromKey/);
  assert.match(source, /window\.addEventListener\('keydown', closeTimelineMenuOnEscape\)/);
  assert.match(source, /clearTimeDrag\(\);\s*const current = e\.tracks/);
  const sourceLoop = source.match(/function sourcePlay\(t, event\) \{[\s\S]*?\n}\nfunction sourcePause/)?.[0] || '';
  const simulationLoop = source.match(/function togglePreview\(t\) \{[\s\S]*?\n}\nfunction releaseAllTracks/)?.[0] || '';
  assert.doesNotMatch(sourceLoop, /t\._previewMs\s*=/);
  assert.doesNotMatch(simulationLoop, /t\._previewMs\s*=/);
  assert.match(source, /function sourceTime\(t, event\) \{ if \(!t\._sourcePlaying\) setPlayhead/);
  assert.doesNotMatch(source, /function normalizeTrackWords|function syncWordText|function addWord|function removeWord/);
  assert.doesNotMatch(source, /flatMap\(\(r\) => \[Number\(r\.time\)/);
});

test('逐字时间 token 显示词内进度且只更新当前 DOM 节点', async () => {
  const source = await component();
  assert.match(source, /class="eb-time-token-progress"/);
  assert.match(source, /function tokenProgressPercent\(t, line, word, ms\)/);
  assert.match(source, /timedTokenSpanMs\(row\.words, word, nextRowTime\(t, line\)\)/);
  assert.match(source, /node\.style\.setProperty\('--eb-token-progress', `\$\{percent\}%`\)/);
  assert.match(source, /node\.style\.removeProperty\('--eb-token-progress'\)/);
  assert.match(source, /clearTokenProgress\(view\.activeToken\)/);
  assert.doesNotMatch(source, /_tokenProgress|word\._progress|word\.progress/);
});

test('歌词编辑历史提供按钮、未失焦输入和键盘撤回恢复', async () => {
  const source = await component();
  assert.match(source, /:disabled="!canUndo\(t\)" @click="undoTrack\(t\)">撤回/);
  assert.match(source, /:disabled="!canRedo\(t\)" @click="redoTrack\(t\)">恢复/);
  assert.match(source, /@input="syncRowText\(t, r\); markHistory\(t\)"/);
  assert.match(source, /@input="markHistory\(t\)"\s+@change="applyWholeText\(t\)"/);
  assert.match(source, /window\.addEventListener\('keydown', handleHistoryShortcut\)/);
  assert.match(source, /if \(event\.shiftKey\) redoTrack\(historyTrack\)/);
  assert.match(source, /clearPlaybackView\(t\); nextTick\(\(\) => updateActiveIndices/);
});
