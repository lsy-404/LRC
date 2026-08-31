import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const component = () => readFile(new URL('../docs/.vuepress/components/EditBox.vue', import.meta.url), 'utf8');
const uploadComponent = () => readFile(new URL('../docs/.vuepress/components/UploadBox.vue', import.meta.url), 'utf8');
const workbenchComponent = () => readFile(new URL('../docs/.vuepress/components/Workbench.vue', import.meta.url), 'utf8');
const monacoComponent = () => readFile(new URL('../docs/.vuepress/components/MonacoLrcEditor.vue', import.meta.url), 'utf8');

test('当前曲目可在可视化与 Monaco 源码编辑间切换，源码须显式应用', async () => {
  const [source, monaco] = await Promise.all([component(), monacoComponent()]);
  assert.match(source, /import MonacoLrcEditor from '\.\/MonacoLrcEditor\.vue'/);
  assert.match(source, /可视化编辑/);
  assert.match(source, /源码编辑/);
  assert.match(source, /<MonacoLrcEditor v-model="t\._sourceText" language="lrc"/);
  assert.match(source, /@click="applySourceEditor\(t\)"/);
  assert.match(source, /:disabled="t\.authoritativeLrc" @click="applySourceEditor\(t\)"/);
  assert.match(source, /function applySourceEditor\(t\)[\s\S]*?parseLrc\(text\)[\s\S]*?parseKaraokeRows\(text, t\._sourceFormat === 'klrc' \? text : ''\)/);
  assert.match(source, /_editorMode: 'visual', _sourceFormat: 'lrc'/);
  assert.match(source, /main\.rows = rows[\s\S]*?main\.timingLocked = true[\s\S]*?commitHistory\(t\)/);
  assert.match(monaco, /import\('monaco-editor'\)/);
  assert.match(monaco, /editor\.worker\?worker/);
  assert.match(monaco, /window\.MonacoEnvironment = \{ getWorker/);
  assert.match(monaco, /languages\.register\(\{ id: 'lrc'/);
  assert.match(monaco, /wordTimestamp|timestamp|credit/);
  assert.match(monaco, /ResizeObserver/);
  assert.match(monaco, /editor\?\.dispose\(\); model\?\.dispose\(\)/);
});

test('审核工作站以 Explorer 资源树切换 Meta 与当前曲目，右侧保持独立编辑区', async () => {
  const source = await component();
  assert.match(source, /class="eb-editor-shell rise"/);
  assert.match(source, /class="eb-activity-bar" aria-label="工作站活动栏"/);
  assert.match(source, /class="eb-explorer" aria-label="审核专辑资源树"/);
  assert.match(source, /@click="selectMeta\(e\)"/);
  assert.match(source, /@click="selectEditorTrack\(e, index\)"/);
  assert.match(source, /const selectedEdits = computed/);
  assert.match(source, /_activePane: 'meta'/);
  assert.match(source, /<div v-if="e\._activePane === 'meta'" class="eb-meta-editor">/);
  assert.match(source, /<div v-else class="eb-track-editor">/);
  assert.match(source, /function selectEditorTrack\(edit, index\) \{[\s\S]*?edit\._activePane = 'track';[\s\S]*?await selectTrack\(edit\);/);
  assert.match(source, /保存专辑信息/);
  assert.match(source, /@media \(max-width: 520px\) \{[\s\S]*?\.eb-editor-shell \{ display: block;/);
});

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
  assert.match(source, /class="eb-workbench"[\s\S]*data-workbench="true"[\s\S]*tabindex="0"/);
  assert.match(source, /class="eb-editor-panel">\s*<div class="eb-inline-player">/);
  assert.match(source, /class="eb-player" aria-label="播放器"/);
  assert.match(source, /@click="toggleSource\(t\)"/);
  assert.match(source, /@input="seekSource\(t, \$event\)"/);
  assert.match(source, /@click="simplifyTrack\(t\)"/);
  assert.match(source, /@click="openLineEditor\(vocal\)"/);
  assert.match(source, /removeKnownSttWatermarkTokens\(row\.words\)/);
  assert.match(source, /if \(!track\.authoritativeLrc\) sanitizeGeneratedTrack\(track\);/);
  assert.match(source, /@click="addLine\(vocal, li\)"/);
  assert.match(source, /class="eb-word-timeline" role="region" aria-label="逐字时间轨"/);
  assert.match(source, /class="eb-time-track"/);
  assert.doesNotMatch(source, /eb-time-token-(?:lower|upper)/);
  assert.match(source, /const rowEnd = timedSentenceEndMs\(row, nextRowTime/);
  assert.match(source, /--eb-time-grow/);
  assert.match(source, /flex: var\(--eb-time-grow, 1\) 0 0/);
  assert.doesNotMatch(source, /\.eb-time-track \{[^}]*min-width: max-content/);
  assert.match(source, /timelineTokenStyle\(vocal, r, li, wi\)/);
  assert.match(source, /part\.timingLocked \? words : expandTimedTokens\(words, newId, 100, Number\(parsedRows\[index \+ 1\]\?\.time\)\)/);
  assert.match(source, /@pointerdown="startTimeDrag\(vocal, r, wi, \$event\)"/);
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
  assert.match(source, /bindLineNode\(vocal, li, node\)/);
  assert.match(source, /bindTokenNode\(vocal, li, wi, node\)/);
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

test('整行编辑保存逐字对象，并提供上下文、插入、和声、删除四个紧凑按钮', async () => {
  const source = await component();
  assert.match(source, /reconcileWordCharacters\(row\.words, row\.text, newId, row\.time\)/);
  assert.match(source, /@select="recordCursor\(r, \$event\)"/);
  assert.match(source, /aria-label="插入歌词行"/);
  assert.match(source, /aria-label="删除歌词行"/);
  assert.equal((source.split('<script setup>')[0].match(/eb-icon-btn/g) || []).length, 4);
  assert.match(source, /textRowBoundaryIcon\(r, li\)[\s\S]*?textRowBoundaryAction\(row, rowIndex\) === 'merge' \? '↤' : '✂'/);
  assert.doesNotMatch(source, /moveTimedSelection|moveSelectionToNext/);
  assert.match(source, /function applyTextRowBoundary\(t, row, rowIndex\) \{\s*if \(t\.authoritativeLrc\) return;\s*const action = textRowBoundaryAction\(row, rowIndex\)/);
  assert.doesNotMatch(source, /splitFromCursor/);
  assert.doesNotMatch(source, /选中移下一句/);
  assert.match(source, /utf16ToCodePointIndex\(row\.text, event\.target\.selectionStart\)/);
  assert.match(source, /function syncTrackText\(t\)/);
  assert.match(source, /@change="applyWholeText\(vocal\)"/);
});

test('时间轨提供慢速、边界菜单与受控拖动清理', async () => {
  const source = await component();
  assert.match(source, /const PLAYBACK_RATES = \[0\.1, 0\.25, 0\.5, 1, 1\.5, 2\]/);
  assert.match(source, /v-for="rate in PLAYBACK_RATES"/);
  assert.match(source, /contextmenu\.prevent\.stop="openTimelineMenu/);
  assert.match(source, /@contextmenu\.prevent\.stop="openTimelineMenu\(vocal, r, wi, 0, \$event\)"/);
  assert.match(source, /timelineMenu && timelineMenu\.rowId === r\._id/);
  assert.match(source, /position: fixed/);
  assert.match(source, /splitRowAtTokenBoundary\(menu\.t\.rows/);
  assert.match(source, /mergeTimedRows\(menu\.t\.rows, menu\.rowIndex\)/);
  assert.match(source, /closeTimelineMenu/);
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /@lostpointercapture="finishTimeDrag\(\$event\)"/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /clearTimeDrag\(\)/);
  assert.match(source, /function timelineBoundaryAction\(menu\)/);
  assert.match(source, /合并到上一句/);
  assert.match(source, /从此处拆分/);
  assert.match(source, /function handleWorkbenchShortcut\(t, event\)/);
  assert.match(source, /function handleWorkbenchKeydown\(event\)/);
  assert.match(source, /window\.addEventListener\('keydown', handleWorkbenchKeydown\)/);
  assert.match(source, /window\.removeEventListener\('keydown', handleWorkbenchKeydown\)/);
  assert.match(source, /function bindWorkbenchNode\(t, node\)/);
  assert.match(source, /function isWorkbenchTextTarget\(target\)/);
  assert.match(source, /workbenchTracks\.has\(workbench\)[\s\S]*?workbenchTracks\.get\(workbench\)[\s\S]*?activeWorkbenchTrack/);
  assert.match(source, /target\.closest\('button'\) && event\.key === ' '/);
  assert.match(source, /event\.key === ' '/);
  assert.match(source, /event\.key === 'ArrowUp' \|\| event\.key === 'ArrowDown'/);
  assert.match(source, /nudgePlayhead\(t, event\.key === 'ArrowLeft' \? -1000 : 1000\)/);
  assert.match(source, /function seekTrack\(t, ms\)/);
  assert.match(source, /seekTrack\(t, Number\(t\.rows\[next\]\?\.time\) \|\| 0\)/);
  assert.match(source, /if \(event\.repeat\) return/);
  assert.match(source, /if \(t\._audioUrl && !t\._audioErr\) toggleSource\(t\); else togglePreview\(t\)/);
  assert.match(source, /input, textarea, select, \[contenteditable\]/);
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

test('待处理列表显示实时作业信息，处理中项不可打开且待审核项可打开', async () => {
  const source = await component();
  assert.match(source, /p\.message \|\| pendingStageText\(p\)/);
  assert.match(source, /p\.progress != null/);
  assert.match(source, /function pendingStageText\(item\)/);
  assert.match(source, /:disabled="!canOpenPending\(p\)"/);
  assert.match(source, /function pendingLockReason\(item\) \{ return isProcessingPending\(item\) \? '处理中，暂不可编辑'/);
  assert.match(source, /function canOpenPending\(item\) \{ return !isProcessingPending\(item\)/);
  assert.match(source, /function pick\(p\) \{\s*if \(!canOpenPending\(p\)\) return;/);
  assert.match(source, /pendingPollTimer = setInterval\(loadPending, 12000\)/);
  assert.doesNotMatch(source, /const active = pending\.value\.find/);
});

test('失败投稿可在待处理列表中重试，且始终不能直接进入编辑', async () => {
  const source = await component();
  assert.match(source, /v-if="isFailedPending\(p\)"[\s\S]*?@click\.stop="retryPending\(p\)"/);
  assert.match(source, /isRetryingPending\(p\) \? '重试中…' : '重试'/);
  assert.match(source, /function isFailedPending\(item\) \{ return item\?\.state === 'failed' \|\| item\?\.status === 'failed'; \}/);
  assert.match(source, /function canOpenPending\(item\) \{ return !isProcessingPending\(item\) && item\?\.state !== 'failed' && item\?\.status !== 'failed'; \}/);
  assert.match(source, /async function retryPending\(p\) \{[\s\S]*?fetch\('\/api\/ingest\/retry'/);
  assert.match(source, /headers: \{ 'content-type': 'application\/json', \.\.\.authHeaders\(\) \}/);
  assert.match(source, /await loadPending\(\);/);
  assert.match(source, /message: `重试失败：\$\{data\.message \|\| data\.error \|\| `HTTP \$\{resp\.status\}`\}`/);
});

test('失败说明不会覆盖待投稿项右侧重试操作，窄屏可换行阅读', async () => {
  const source = await component();
  assert.match(source, /class="eb-p-meta" :title="p\.message \|\| pendingStageText\(p\)"/);
  assert.match(source, /\.eb-p-meta \{ min-width: 0; overflow: hidden; text-overflow: ellipsis;[^}]*white-space: nowrap; \}/);
  assert.match(source, /\.eb-p-right \{ display: flex; flex: 0 0 auto; flex-shrink: 0;[^}]*position: relative; z-index: 1; \}/);
  assert.match(source, /\.eb-pending li \{[\s\S]*?flex-wrap: wrap;/);
  assert.match(source, /@media \(max-width: 720px\) \{[\s\S]*?\.eb-pending-open \{ flex-basis: 100%; flex-direction: column;/);
});

test('逐字时间轨显示句内偏移、支持单字编辑且只更新整句进度', async () => {
  const source = await component();
  assert.match(source, /:contenteditable="t\.authoritativeLrc \? 'false' : 'plaintext-only'"/);
  assert.match(source, /formatWordOffset\(r, word\.time\)/);
  assert.match(source, /return `\+\$\{msToTimestamp\(wordOffset\(row, time\)\)\}`/);
  assert.match(source, /row\.text = updated\.text/);
  assert.match(source, /label\.textContent = formatWordOffset\(state\.row, item\.startTime \+ offset\)/);
  assert.match(source, /class="eb-time-sentence-progress"/);
  assert.match(source, /--eb-sentence-progress/);
  assert.match(source, /timedTrailingGapMs\(row, next\)/);
  assert.match(source, /if \(Number\.isFinite\(next\) && next > Number\(row\.time\)\) return \{ '--eb-time-grow': 0 \};/);
  assert.match(source, /return \{ '--eb-time-grow': Math\.max\(0, Number\(duration\) \|\| 0\) \};/);
  assert.doesNotMatch(source, /timedSpanFlexWeight\(duration\)/);
  assert.doesNotMatch(source, /eb-time-token-progress|--eb-token-progress|tokenProgressPercent|clearTokenProgress/);
});

test('逐字时间标记输入保留完整文本，并以清空标记方式暴露缺字槽位', async () => {
  const source = await component();
  assert.match(source, /class="eb-time-chars" :contenteditable="t\.authoritativeLrc \? 'false' : 'plaintext-only'"/);
  assert.match(source, /@input="editTimelineChar\(vocal, r, wi, \$event\)"/);
  assert.match(source, /可输入多个字/);
  assert.match(source, /replaceTimedTokenText\(row, wordIndex, next\)/);
  assert.doesNotMatch(source, /entered\[entered\.length - 1\]/);
  assert.match(source, /row\.words = updated\.words/);
  assert.match(source, /row\.text = updated\.text/);
  assert.match(source, /String\(event\.currentTarget\.textContent \|\| ''\)\.replace/);
  assert.match(source, /part\.timingLocked \? words : expandTimedTokens/);
});

test('逐字时间轨为稀疏句提供更大的前后操作距离且保留安全夹紧', async () => {
  const source = await component();
  assert.match(source, /:style="timelineTrackStyle\(vocal, r, li\)"/);
  assert.match(source, /const TIMELINE_MS_PER_PIXEL = 5/);
  assert.match(source, /const TIMELINE_PADDING_PX = 64/);
  assert.match(source, /function timelineTrackStyle\(t, row, rowIndex\)/);
  assert.match(source, /--eb-timeline-width/);
  assert.match(source, /width: max\(100%, var\(--eb-timeline-width, 100%\)\)/);
  assert.match(source, /padding: 0 4rem 3px/);
  assert.match(source, /state\.startTime \+ \(state\.x - state\.startX\) \* TIMELINE_MS_PER_PIXEL/);
  assert.match(source, /boundedTimedSelectionOffset\(state\.row\.words, state\.indices/);
  assert.match(source, /touch-action: none/);
  assert.match(source, /function boundedWordTime\(t, row, index, time\)/);
});

test('逐字时间轨把正文缺字显示为可点击补标槽位，不使用原生输入框', async () => {
  const source = await component();
  assert.match(source, /missingTimedCharacterSlots\(row\)\.filter/);
  assert.match(source, /insertMissingTimedCharacter\(row, textIndex, newId, nextRowTime/);
  assert.match(source, /class="eb-time-missing"/);
  assert.match(source, /为 \$\{slot\.text\} 新增时间标记/);
  assert.doesNotMatch(source, /window\.prompt|\bprompt\s*\(/);
});

test('歌词编辑历史提供按钮、未失焦输入和键盘撤回恢复', async () => {
  const source = await component();
  assert.match(source, /:disabled="t\.authoritativeLrc \|\| !canUndo\(t\)" @click="undoTrack\(t\)">撤回/);
  assert.match(source, /:disabled="t\.authoritativeLrc \|\| !canRedo\(t\)" @click="redoTrack\(t\)">恢复/);
  assert.match(source, /@input="syncRowText\(vocal, r\); markHistory\(vocal\)"/);
  assert.match(source, /@input="markHistory\(vocal\)"\s+@change="applyWholeText\(vocal\)"/);
  assert.match(source, /window\.addEventListener\('keydown', handleHistoryShortcut\)/);
  assert.match(source, /if \(event\.shiftKey\) redoTrack\(historyTrack\)/);
  assert.match(source, /clearPlaybackView\(t\);\s+nextTick\(\(\) => updateAllVocalHighlights/);
});

test('主唱与和声在同一工作台内共享可编辑时间轴，并以文字颜色条区分', async () => {
  const source = await component();
  assert.match(source, /parseVocalDrafts\(t\)\.map\(makeVocal\)/);
  assert.match(source, /serializeVocalDrafts\(t\._vocals\)/);
  assert.match(source, /class="eb-vocal-legend" aria-label="主唱与和声图例"/);
  assert.match(source, /eb-vocal-key main">主唱/);
  assert.match(source, /eb-vocal-key harmony">和声/);
  assert.match(source, /class="eb-vocal-lane" :class="vocalLaneClass\(vocal, vi\)"/);
  assert.match(source, /v-for="\(r, li\) in vocal\.rows"/);
  assert.match(source, /bindLineNode\(vocal, li, node\)/);
  assert.match(source, /bindTokenNode\(vocal, li, wi, node\)/);
  assert.match(source, /--eb-vocal-color/);
  assert.doesNotMatch(source, /eb-vocal-overlap|eb-vocal-bar|添加声部|\b合音\b/);
  assert.match(source, /function updateAllVocalHighlights\(t, ms\)/);
  assert.match(source, /for \(const vocal of t\._vocals\) updateActiveIndices\(vocal, ms\)/);
  assert.match(source, /updateAllVocalHighlights\(t, ms\)/);
});

test('逐行支持标为和声与并回主唱，迁移保留时间并使用当前歌词流边界', async () => {
  const source = await component();
  assert.match(source, /标为和声/);
  assert.match(source, /并回主唱/);
  assert.match(source, /@click="toggleHarmonyRow\(vocal, r\)"/);
  assert.match(source, /function ensureHarmonyVocal\(t\)/);
  assert.match(source, /id: 'harmony', name: '和声'/);
  assert.match(source, /function toggleHarmonyRow\(vocal, row\)/);
  assert.match(source, /transferTimedVocalRow\(t\._vocals, sourceIndex, rowIndex, targetIndex\)/);
  assert.match(source, /t\._vocals\[targetIndex\]\.timingLocked = true/);
  assert.match(source, /t\._vocals\[targetIndex\]\._view = 'lrc'/);
  assert.match(source, /function nextRowTime\(t, rowIndex\) \{ return Number\(t\.rows\[rowIndex \+ 1\]\?\.time\); \}/);
  assert.match(source, /function shiftRowTime\(t, row\)/);
  assert.match(source, /nextTick\(\(\) => updateAllVocalHighlights\(t, playheadMs\(t\)\)\)/);
});

test('专辑名称可编辑但审核存储定位保持原投稿名', async () => {
  const source = await component();
  assert.match(source, /v-model="e\.album" class="eb-input eb-album" aria-label="专辑名称" @input="syncPendingDisplay\(e\)"/);
  assert.match(source, /_storageAlbum: album/);
  assert.match(source, /toEdit\(a\.storage_album, a\.draft\)/);
  assert.match(source, /discard\(p\.ref, p\.storage_album, p\.album\)/);
  assert.match(source, /p\.storage_album === album/);
  assert.match(source, /await loadPending\(\)/);
  assert.match(source, /album: e\._storageAlbum, draft/);
  assert.match(source, /album: e\._storageAlbum, ext/);
  assert.match(source, /function cleanAlbumName\(value, fallback\)/);
  assert.match(source, /names\.zh_name =/);
  assert.match(source, /const draft = toDraft\(e\)/);
  assert.match(source, /e\.album = draft\.album/);
});

test('和声迁移使用紧凑图标按钮并保留可访问名称', async () => {
  const source = await component();
  assert.match(source, /:aria-label="vi \? '并回主唱' : '标为和声'"/);
  assert.match(source, /function harmonyRowIcon\(vocal\) \{ return vocal\.id === 'main' \? '♫' : '↩'; \}/);
  assert.match(source, /toggleHarmonyRow\(vocal, r\)\">\{\{ harmonyRowIcon\(vocal\) \}\}/);
});

test('逐字时间轨高亮同时间戳簇，并按真实相邻时间布局', async () => {
  const source = await component();
  assert.match(source, /:class="\[timelineTokenClass\(r, wi\), \{ selected: isTimelineTokenSelected/);
  assert.match(source, /function timelineTokenClass\(row, wordIndex\)/);
  assert.match(source, /same-timestamp/);
  assert.match(source, /timedTokenLayout\(row\.words, wordIndex/);
  assert.match(source, /min-width: max-content/);
});
