<template>
<section class="eb-track" @focusin="setHistoryTrack(track,$event)" @focusout="clearHistoryTrack(track,$event)">
          <div class="eb-track-head">
            <input v-model.number="track.order" :readonly="readOnly" type="number" class="eb-input tiny" title="序号" @input="markHistory(track)" @change="commitHistory(track)">
            <input v-model="track.title" :readonly="readOnly" class="eb-input grow" placeholder="曲名" @input="markHistory(track)" @blur="commitHistory(track)">
            <input v-model="track.outputName" :readonly="readOnly" class="eb-input output-name" placeholder="输出文件名" aria-label="输出文件名" @input="markHistory(track)" @blur="commitHistory(track)">
            <span v-if="isLowConf(track)" class="eb-tag conf" title="视觉分轨的识别置信度低，请重点核对曲名与归属">
              识别低置信 {{ pct(track.confidence) }}
            </span>
            <span v-if="showLowCov(track)" class="eb-tag cov" title="时间轴对齐覆盖率低，时间戳可能不准">
              对齐覆盖 {{ pct(track.coverage) }}
            </span>
            <span v-if="locked" class="eb-tag" title="上传的 LRC 原文与行时间戳受保护；仅补充逐字侧车和元数据">
              权威 LRC
            </span>
            <span v-if="isDirty(track)" class="eb-tag edit" title="确认后 Phase B 会对该轨重新对齐">
              已修改 · 待重对齐
            </span>
            <label class="eb-inst"><input v-model="track.inst" :disabled="readOnly" type="checkbox" @change="commitHistory(track)"> 伴奏/无人声</label>
            <input v-if="track.inst" v-model="track.finalName" :readonly="readOnly" class="eb-input output-name" placeholder="最终文件名" aria-label="最终文件名" @input="markHistory(track)" @blur="commitHistory(track)">
          </div>

          <div class="eb-track-bar">
            <span class="eb-dim">{{ trackState(track) }}</span>
            <span class="eb-spacer" />
            <button class="eb-btn small" :disabled="locked" @click="simplifyTrack(track)">转简体/清理水印</button>
            <button class="eb-btn small" :disabled="locked || !canUndo(track)" @click="undoTrack(track)">撤回</button>
            <button class="eb-btn small" :disabled="locked || !canRedo(track)" @click="redoTrack(track)">恢复</button>
          </div>

          <div class="eb-vocal-legend" aria-label="主唱与和声图例">
            <span class="eb-vocal-key main">主唱</span>
            <span v-if="hasHarmony(track)" class="eb-vocal-key harmony">和声</span>
          </div>

          <div
            :ref="(node) => bindWorkbenchNode(track, node)"
            class="eb-workbench"
            data-workbench="true"
            tabindex="0"
            aria-label="歌词校对工作区"
            @focusin="setWorkbenchFocus(track)"
            @pointerdown="setWorkbenchFocus(track)"
          >
            <div class="eb-editor-panel">
              <div class="eb-inline-player">
              <div v-if="audioUrl" class="eb-preview">
              <span v-if="track._audioLoading" class="eb-dim">载入原曲…<template v-if="track._audioProgress >= 0"> {{ track._audioProgress }}%</template></span>
              <div v-else-if="audioUrl && !track._audioErr" class="eb-player" aria-label="播放器">
                <button class="eb-btn small" @click="toggleSource(track)">{{ track._sourcePlaying ? '暂停' : '播放' }}</button>
                <input :ref="(node) => bindProgressNode(track, node)" class="eb-player-progress" :value="track._previewMs" type="range" min="0" :max="sourceEnd(track)" aria-label="播放进度" @input="seekSource(track, $event)">
                <span :ref="(node) => bindPlayerTimeNode(track, node)" class="eb-player-time">{{ formatMs(track._previewMs) }} / {{ formatMs(track._audioDuration) }}</span>
                <label>音量 <input v-model.number="track._volume" type="range" min="0" max="1" step="0.05" @input="setVolume(track)"></label>
                <label>速度 <select v-model.number="track._speed" class="eb-select" @change="setSourceRate(track)"><option v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate">{{ rate }}×</option></select></label>
              </div>
              <button v-else class="eb-btn small" @click="togglePreview(track)">重试</button>
              <span v-if="track._audioErr" class="eb-msg inline err">{{ track._audioErr }}</span>
              </div>
              <div v-if="(!audioUrl && !track._audioLoading) || track._audioErr" class="eb-preview eb-simulation">
              <button class="eb-btn small" @click="togglePreview(track)">{{ track._playing ? '暂停' : '播放' }}</button>
              <label>速度 <select v-model.number="track._speed" class="eb-select"><option v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate">{{ rate }}×</option></select></label>
              <input :ref="(node) => bindProgressNode(track, node)" :value="track._previewMs" type="range" min="0" :max="previewEnd(track)" aria-label="播放进度" @input="seekPreview(track, $event)">
              <span :ref="(node) => bindPlayerTimeNode(track, node)">{{ formatMs(track._previewMs) }}</span>
              </div>
              </div>
              <div v-for="(vocal, vi) in track._vocals" :key="vocal.id" class="eb-vocal-lane" :class="vocalLaneClass(vocal, vi)">
              <div class="eb-vocal-lane-label"><span>{{ vocalLabel(vocal, vi) }}</span><div class="eb-edit-switch"><button class="eb-btn small" :class="{ on: vocal._view === 'lrc' }" @click="openLineEditor(vocal)">逐行与逐字</button><button class="eb-btn small" :class="{ on: vocal._view === 'text' }" @click="vocal._view = 'text'">整段文本</button></div></div>
              <div v-if="vocal.head.length" class="eb-lrc-head"><div v-for="(h, hi) in vocal.head" :key="hi">{{ h }}</div></div>
              <div v-if="vocal._view === 'lrc'">
              <div v-for="(r, li) in vocal.rows" :key="r._id" :ref="(node) => bindLineNode(vocal, li, node)" class="eb-line-editor" @focusin="activateVocal(track, vi)">
              <div class="eb-lrc-row">
                <label class="eb-time"><input v-model.number="r.time" type="number" min="0" step="10" class="eb-input ms" :readonly="locked" @focus="beginRowTimeEdit(r)" @input="shiftRowTime(vocal, r)" @change="finishRowTimeEdit(vocal, r)" @blur="finishRowTimeEdit(vocal, r)">毫秒</label>
                <input v-model="r.text" class="eb-input lrc" :readonly="locked" @input="syncRowText(vocal, r); markHistory(vocal)" @blur="commitHistory(vocal)" @click="recordCursor(r, $event)" @keyup="recordCursor(r, $event)" @select="recordCursor(r, $event)">
                <button class="eb-btn small eb-icon-btn" :disabled="locked || textRowBoundaryAction(r, li) === 'none'" :aria-label="textRowBoundaryLabel(r, li)" :title="textRowBoundaryLabel(r, li)" @click="applyTextRowBoundary(vocal, r, li)">{{ textRowBoundaryIcon(r, li) }}</button><button class="eb-btn small eb-icon-btn" :disabled="locked" aria-label="插入歌词行" title="插入歌词行" @click="addLine(vocal, li)">＋</button><button class="eb-btn small eb-icon-btn" :disabled="locked" :aria-label="vi ? '并回主唱' : '标为和声'" :title="vi ? '并回主唱' : '标为和声'" @click="toggleHarmonyRow(vocal, r)">{{ harmonyRowIcon(vocal) }}</button><button class="eb-btn small danger eb-icon-btn" :disabled="locked" aria-label="删除歌词行" title="删除歌词行" @click="removeLine(vocal, li)">×</button>
              </div>
              <div class="eb-word-timeline" role="region" aria-label="逐字时间轨">
                <div class="eb-time-track" :style="timelineTrackStyle(vocal, r, li)">
                  <span class="eb-time-lead" :style="timelineLeadStyle(r)" aria-hidden="true" />
                  <button v-for="slot in missingMarkerSlots(r, 0)" :key="`missing-${r._id}-${slot.textIndex}`" class="eb-time-missing" :disabled="locked" :title="`为 ${slot.text} 新增时间标记`" :aria-label="`为 ${slot.text} 新增时间标记`" @click="insertMissingMarker(vocal, r, li, slot.textIndex)">{{ slot.text }}</button>
                  <template v-for="(word, wi) in r.words" :key="word._id">
                  <div :ref="(node) => bindTokenNode(vocal, li, wi, node)" class="eb-time-token" :class="[timelineTokenClass(r, wi), { selected: isTimelineTokenSelected(vocal, r, wi) }]" :style="timelineTokenStyle(vocal, r, li, wi)">
                    <span class="eb-time-chars" :contenteditable="locked ? 'false' : 'plaintext-only'" spellcheck="false" tabindex="0" :aria-label="timelineTokenLabel(r, wi)" title="右键任一字符可在此切分，或与前一段合并" @focus="selectTimelineChar" @input="editTimelineChar(vocal, r, wi, $event)" @keydown="openTimelineMenuFromKey(vocal, r, wi, 0, $event)" @keydown.enter.prevent="$event.currentTarget.blur()"><span v-for="(char, ci) in Array.from(word.text)" :key="`${word._id}-${ci}`" class="eb-time-char" @contextmenu.prevent.stop="!locked && openTimelineMenu(vocal, r, wi, ci, $event)">{{ char }}</span></span>
                    <button class="eb-time-marker" :disabled="locked" :aria-label="`调整 ${word.text} 的句内偏移`" :aria-pressed="isTimelineTokenSelected(vocal, r, wi)" title="按住 Command 或 Ctrl 选择多个标记后整体拖动" @pointerdown="startTimeDrag(vocal, r, wi, $event)" @pointermove="moveTimeDrag($event)" @pointerup="finishTimeDrag($event)" @pointercancel="finishTimeDrag($event)" @lostpointercapture="finishTimeDrag($event)" @contextmenu.prevent.stop="openTimelineMenu(vocal, r, wi, 0, $event)" @keydown="nudgeWordTime(vocal, r, wi, $event)"><span>{{ formatWordOffset(r, word.time) }}</span></button>
                  </div>
                  <button v-for="slot in missingMarkerSlots(r, wi + 1)" :key="`missing-${r._id}-${slot.textIndex}`" class="eb-time-missing" :disabled="locked" :title="`为 ${slot.text} 新增时间标记`" :aria-label="`为 ${slot.text} 新增时间标记`" @click="insertMissingMarker(vocal, r, li, slot.textIndex)">{{ slot.text }}</button>
                  </template>
                  <span class="eb-time-trailing" :style="timelineTrailingStyle(vocal, r, li)" aria-hidden="true" />
                  <span :ref="(node) => bindRowProgressNode(vocal, li, node)" class="eb-time-sentence-progress" aria-hidden="true" />
                </div>
              </div>
              <div v-if="timelineMenu && timelineMenu.rowId === r._id && timelineMenu.t === vocal" class="eb-timeline-menu" role="menu" :style="{ left: `${timelineMenu.x}px`, top: `${timelineMenu.y}px` }" @keydown.esc="closeTimelineMenu">
                <button v-if="timelineMenu.charIndex || timelineMenu.wordIndex" role="menuitem" class="eb-btn small" :disabled="locked" :title="timelineMenu.charIndex ? '新增此处的时间标签' : '删除当前时间标签（并入前字）'" @click.stop="applyTimelineBoundary">{{ timelineMenu.charIndex ? '在此新增时间标签' : '删除当前时间标签（并入前字）' }}</button>
                <button role="menuitem" class="eb-btn small" :disabled="locked || timelineBoundaryAction(timelineMenu) === 'none'" @click.stop="applyRowBoundary">{{ timelineBoundaryLabel(timelineMenu) }}</button>
              </div>
            </div>
              <button class="eb-btn small" :disabled="locked" @click="addLine(vocal, vocal.rows.length - 1)">新增歌词行</button>
              </div>
              <textarea
                v-else
              v-model="vocal.text"
              class="eb-textarea"
              rows="6"
              :readonly="locked"
              @input="markHistory(vocal)"
              @change="applyWholeText(vocal)"
              @blur="commitHistory(vocal)"
              :placeholder="track.inst ? '伴奏轨：留空则借同名正曲时间轴或写占位' : '逐行歌词'"
              />
              <button v-if="vocal._view === 'text'" class="eb-btn small" :disabled="locked" @click="applyWholeText(vocal)">应用整段文本并保留时间轴</button>
            </div>
            </div>
          </div>
          <audio
            v-if="audioUrl"
            :ref="(node) => bindAudioElement(track, node)"
            class="eb-hidden-audio"
            :src="audioUrl"
            preload="auto"
            @play="sourcePlay(track, $event)"
            @pause="sourcePause(track)"
            @ended="sourcePause(track)"
            @error="sourceError(track)"
            @loadedmetadata="sourceReady(track, $event)"
            @durationchange="sourceReady(track, $event)"
            @timeupdate="sourceTime(track, $event)"
          />
</section>
</template>
<script setup>
import { computed, ref, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import OpenCC from 'opencc-js/t2cn';
import { activeIndexAt, boundedTimedSelectionOffset, clampWordTime, expandTimedTokens, insertMissingTimedCharacter, mergeTimedRows, mergeTimedToken, missingTimedCharacterSlots, parseLrc, parseKaraokeRows, reconcileTimedRows, reconcileWordCharacters, replaceTimedTokenText, serializeTimedLyrics, shiftTimedRow, splitTimedRow, splitTimedToken, splitRowAtTokenBoundary, textToLines, linesToText, timedSentenceEndMs, timedTokenLayout, timedTrailingGapMs, timedRowBoundaryAction, transferTimedVocalRow, utf16ToCodePointIndex, msToTimestamp } from './lrcDraft.js';
import { canRedoLyricHistory, canUndoLyricHistory, markLyricHistoryDirty, recordLyricHistory, redoLyricHistory, undoLyricHistory, createLyricHistory } from './lyricHistory.js';
import { persistVocal, sanitizeGeneratedTrack } from './workspaceDocument.js';
const { track, audioUrl, readOnly } = defineProps({ track:{type:Object,required:true}, audioUrl:{type:String,default:''}, readOnly:{type:Boolean,default:false}, theme:{type:String,default:''} }); const emit=defineEmits(['update']); const locked = computed(() => readOnly || track.authoritativeLrc); const toSimplified=OpenCC.Converter({from:'t',to:'cn'}); const PLAYBACK_RATES=[0.1,.25,.5,1,1.5,2]; const SOURCE_CURSOR_INTERVAL_MS=40; const SOURCE_PROGRESS_INTERVAL_MS=80; const timelineMenu=ref(null); const timelineSelection=ref(null); let dragState=null,historyTrack=null,activeWorkbenchTrack=null; const rowTimeEdits=new WeakMap(),playheads=new WeakMap(),playbackViews=new WeakMap(),workbenchTracks=new WeakMap(); const newId=()=>`timing-${crypto.randomUUID()}`; const TIMELINE_MS_PER_PIXEL=5,TIMELINE_PADDING_PX=64; function changed(){emit('update',track)} function ensure(){if(!track._history)track._history=createLyricHistory(track);if(!track._vocals?.length)track._vocals=[{id:'main',head:track.head||[],rows:track.rows||[],text:track.text||'',timingLocked:!!track.timingLocked,_view:'lrc'}];for(const v of track._vocals){v._owner=track;v._history=track._history;v.name=v.id==='main'?'主唱':'和声';v._view||='lrc'}}
function syncTrackText(t) { t.text = linesToText(t.rows.map((row) => row.text)); }

function nextRowTime(t, rowIndex) { return Number(t.rows[rowIndex + 1]?.time); }
function timelineTrackStyle(t, row, rowIndex) {
  const next = nextRowTime(t, rowIndex);
  const start = Number(row.time);
  const end = timedSentenceEndMs(row, next);
  const span = Number.isFinite(start) && Number.isFinite(end) ? Math.max(1000, end - start) : 1000;
  return { '--eb-timeline-width': `${Math.ceil(span / TIMELINE_MS_PER_PIXEL) + TIMELINE_PADDING_PX * 2}px` };
}
// Keep flex weights in milliseconds so the track's fixed width maps directly to time.
function timelineLeadStyle(row) {
  const start = Number(row.time);
  const first = Number(row.words[0]?.time);
  return { '--eb-time-grow': Number.isFinite(start) && Number.isFinite(first) && first > start ? first - start : 0 };
}
function timelineTokenStyle(t, row, rowIndex, wordIndex) {
  const rowEnd = timedSentenceEndMs(row, nextRowTime(t, rowIndex));
  const layout = timedTokenLayout(row.words, wordIndex, rowEnd);
  return { '--eb-time-grow': layout.duration };
}
function timelineTokenClass(row, wordIndex) { return { 'same-timestamp': timedTokenLayout(row.words, wordIndex).clusterSize > 1 }; }
function timelineTokenLabel(row, wordIndex) {
  const word = row.words[wordIndex]; const layout = timedTokenLayout(row.words, wordIndex);
  return layout.clusterSize > 1 ? `编辑 ${word.text}，可输入多个字；与 ${layout.clusterSize - 1} 个词元同时间戳` : `编辑 ${word.text}，可输入多个字`;
}
function timelineTrailingStyle(t, row, rowIndex) {
  const next = nextRowTime(t, rowIndex);
  if (Number.isFinite(next) && next > Number(row.time)) return { '--eb-time-grow': 0 };
  const duration = timedTrailingGapMs(row, next);
  return { '--eb-time-grow': Math.max(0, Number(duration) || 0) };
}
function missingMarkerSlots(row, wordIndex) { return missingTimedCharacterSlots(row).filter((slot) => slot.wordIndex === wordIndex); }
function insertMissingMarker(t, row, rowIndex, textIndex) {
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  const next = insertMissingTimedCharacter(row, textIndex, newId, nextRowTime(t, rowIndex));
  if (next === row) return;
  t.rows.splice(rowIndex, 1, next);
  lockTiming(t);
  updateActiveIndices(t, playheadMs(t));
  commitHistory(t);
}
function wordOffset(row, time) { return Math.max(0, Math.round(Number(time) - Number(row?.time))); }
function formatWordOffset(row, time) { return `+${msToTimestamp(wordOffset(row, time))}`; }
function selectTimelineChar(event) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(event.currentTarget);
  selection.removeAllRanges();
  selection.addRange(range);
}
function editTimelineChar(t, row, wordIndex, event) {
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  if (event.isComposing) return;
  const word = row.words[wordIndex];
  if (!word) return;
  const next = String(event.currentTarget.textContent || '').replace(/[\r\n]/g, '');
  const updated = replaceTimedTokenText(row, wordIndex, next);
  if (updated === row) return;
  row.words = updated.words;
  row.text = updated.text;
  syncTrackText(t);
  lockTiming(t);
  commitHistory(t);
  event.currentTarget.blur();
}
function boundedWordTime(t, row, index, time) { const rowIndex = t.rows.findIndex((item) => item._id === row._id); const nextRow = t.rows[rowIndex + 1]; return clampWordTime(row.words, index, time, 10, row.time, index === row.words.length - 1 && nextRow ? Number(nextRow.time) - 10 : Number.POSITIVE_INFINITY); }
function setHistoryTrack(t) { historyTrack = trackOwner(t); }
function clearHistoryTrack(t, event) { if (historyTrack === trackOwner(t) && !event.currentTarget.contains(event.relatedTarget)) historyTrack = null; }
function canUndo(t) { return canUndoLyricHistory(trackOwner(t)._history); }
function canRedo(t) { return canRedoLyricHistory(trackOwner(t)._history); }
function markHistory(t) { if (readOnly) return; markLyricHistoryDirty(trackOwner(t)._history); emit('update', trackOwner(t)); }
function commitHistory(t) { if (readOnly) return; const track = trackOwner(t); if (track !== t) activateVocal(track, track._vocals.indexOf(t)); recordLyricHistory(track._history, track); emit('update', track); }
function restoreHistory(t, restore) {
  if (!restore(t._history, t)) return;
  for (const vocal of t._vocals) { vocal._owner = t; vocal._history = t._history; vocal.name = vocal.id === 'main' ? '主唱' : '和声'; }
  closeTimelineMenu(); clearPlaybackView(t);
  nextTick(() => updateAllVocalHighlights(t, playheadMs(t)));
  emit('update', t);
}
function undoTrack(t) { const track = trackOwner(t); if (!readOnly && !track.authoritativeLrc) restoreHistory(track, undoLyricHistory); }
function redoTrack(t) { const track = trackOwner(t); if (!readOnly && !track.authoritativeLrc) restoreHistory(track, redoLyricHistory); }
function setWordTime(t, row, index, time) { if (readOnly || trackOwner(t).authoritativeLrc) return; row.words[index].time = boundedWordTime(t, row, index, time); updateActiveIndices(t, playheadMs(t)); lockTiming(t); commitHistory(t); }
function beginRowTimeEdit(row) { rowTimeEdits.set(row, Number(row.time) || 0); }
function shiftRowTime(t, row) {
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  const previous = rowTimeEdits.has(row) ? rowTimeEdits.get(row) : Number(row.time) || 0;
  const shifted = shiftTimedRow(row, row.time, previous);
  row.time = shifted.time;
  row.words = shifted.words;
  rowTimeEdits.set(row, row.time);
  if (row.time !== previous) { markHistory(t); lockTiming(t); }
}
function finishRowTimeEdit(t, row) {
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  rowTimeEdits.delete(row);
  normalizeRows(t);
  lockTiming(t);
  updateActiveIndices(t, playheadMs(t));
  commitHistory(t);
}
function nudgeWordTime(t, row, index, event) { if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || t.authoritativeLrc) return; event.preventDefault(); setWordTime(t, row, index, Number(row.words[index].time) + (event.key === 'ArrowLeft' ? -10 : 10)); }
function closeTimelineMenu() { timelineMenu.value = null; }
function openTimelineMenu(t, row, wordIndex, charIndex, event) { if (readOnly || trackOwner(t).authoritativeLrc) return; const x = Math.max(8, Math.min(window.innerWidth - 240, Number(event.clientX) || 8)); const y = Math.max(8, Math.min(window.innerHeight - 120, Number(event.clientY) || 8)); timelineMenu.value = { t, row, rowId: row._id, wordIndex, charIndex, rowIndex: t.rows.findIndex((item) => item._id === row._id), x, y }; nextTick(() => document.querySelector('.eb-timeline-menu [role="menuitem"]:not([disabled])')?.focus()); }
function openTimelineMenuFromKey(t, row, wordIndex, charIndex, event) { if (!(event.shiftKey && event.key === 'F10') && event.key !== 'ContextMenu') return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openTimelineMenu(t, row, wordIndex, charIndex, { clientX: rect.left, clientY: rect.bottom }); }
function applyTimelineBoundary() { const menu = timelineMenu.value; if (!menu || menu.t.authoritativeLrc) return; const next = menu.charIndex ? splitTimedToken(menu.row, menu.wordIndex, menu.charIndex, newId) : mergeTimedToken(menu.row, menu.wordIndex); if (next !== menu.row) { menu.t.rows.splice(menu.rowIndex, 1, next); syncTrackText(menu.t); lockTiming(menu.t); commitHistory(menu.t); } closeTimelineMenu(); }
function timelineBoundaryAction(menu) { return menu ? timedRowBoundaryAction(menu.rowIndex, menu.wordIndex, menu.charIndex) : 'none'; }
function timelineBoundaryLabel(menu) {
  const action = timelineBoundaryAction(menu);
  return action === 'merge' ? '合并到上一句' : action === 'split' ? '从此处拆分' : '首句首边界无需操作';
}
function applyRowBoundary() {
  const menu = timelineMenu.value;
  const action = timelineBoundaryAction(menu);
  if (!menu || menu.t.authoritativeLrc || action === 'none') return;
  if (action === 'merge') menu.t.rows = mergeTimedRows(menu.t.rows, menu.rowIndex);
  else menu.t.rows = splitRowAtTokenBoundary(menu.t.rows, menu.rowIndex, menu.wordIndex, menu.charIndex, newId);
  syncTrackText(menu.t); lockTiming(menu.t); commitHistory(menu.t); closeTimelineMenu();
}
function textRowBoundaryAction(row, rowIndex) {
  const cursor = row._selection?.start ?? Array.from(row.text || '').length;
  if (rowIndex > 0 && cursor === 0) return 'merge';
  return cursor > 0 && cursor < Array.from(row.text || '').length ? 'split' : 'none';
}
function textRowBoundaryLabel(row, rowIndex) {
  const action = textRowBoundaryAction(row, rowIndex);
  if (action === 'merge') return '合并到上一句';
  if (action === 'split') return '从光标拆分';
  const cursor = row._selection?.start ?? Array.from(row.text || '').length;
  return cursor === 0 && rowIndex === 0 ? '首句首光标无需操作' : '行尾无有效切点';
}
function textRowBoundaryIcon(row, rowIndex) { return textRowBoundaryAction(row, rowIndex) === 'merge' ? '↤' : '✂'; }
function applyTextRowBoundary(t, row, rowIndex) {
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  const action = textRowBoundaryAction(row, rowIndex);
  if (action === 'merge') t.rows = mergeTimedRows(t.rows, rowIndex);
  else if (action === 'split') t.rows = splitTimedRow(t.rows, rowIndex, row._selection?.start ?? Array.from(row.text || '').length, newId);
  else return;
  syncTrackText(t); lockTiming(t); commitHistory(t);
}
function bindWorkbenchNode(t, node) {
  if (node) workbenchTracks.set(node, t);
}
function setWorkbenchFocus(t) { activeWorkbenchTrack = t; }
function isWorkbenchTextTarget(target) {
  return target instanceof Element && target.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}
function handleWorkbenchShortcut(t, event) {
  const target = event.target;
  if (isWorkbenchTextTarget(target)) return;
  if (target instanceof Element && target.closest('button') && event.key === ' ') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const line = playbackView(t).activeLineIndex >= 0 ? playbackView(t).activeLineIndex : 0;
  if (event.key === ' ') { if (event.repeat) return; event.preventDefault(); if (t._audioUrl && !t._audioErr) toggleSource(t); else togglePreview(t); return; }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); nudgePlayhead(t, event.key === 'ArrowLeft' ? -1000 : 1000); return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault(); const next = Math.max(0, Math.min(t.rows.length - 1, line + (event.key === 'ArrowUp' ? -1 : 1))); seekTrack(t, Number(t.rows[next]?.time) || 0); playbackView(t).lines[next]?.scrollIntoView({ block: 'nearest' });
  }
}
function handleWorkbenchKeydown(event) {
  const target = event.target;
  const workbench = target instanceof Element ? target.closest('.eb-workbench') : null;
  const track = workbench && workbenchTracks.has(workbench)
    ? workbenchTracks.get(workbench)
    : activeWorkbenchTrack;
  if (!track) return;
  if (track !== activeWorkbenchTrack) activeWorkbenchTrack = track;
  handleWorkbenchShortcut(track, event);
}
function selectedTimelineIndices(t, row) {
  const selection = timelineSelection.value;
  if (!selection || selection.t !== t || selection.row !== row) return [];
  return row.words.flatMap((word, index) => selection.ids.has(word._id) ? [index] : []);
}
function isTimelineTokenSelected(t, row, index) { return selectedTimelineIndices(t, row).includes(index); }
function selectTimelineTokens(t, row, index, event) {
  const current = selectedTimelineIndices(t, row);
  const ids = new Set(current.map((item) => row.words[item]._id));
  if (event.metaKey || event.ctrlKey) {
    const id = row.words[index]._id;
    if (ids.has(id)) ids.delete(id); else ids.add(id);
  } else if (event.shiftKey && current.length) {
    const start = Math.min(...current); const end = Math.max(...current, index);
    for (let item = start; item <= end; item++) ids.add(row.words[item]._id);
  } else if (!ids.has(row.words[index]._id)) {
    ids.clear(); ids.add(row.words[index]._id);
  }
  timelineSelection.value = ids.size ? { t, row, ids } : null;
  return selectedTimelineIndices(t, row);
}
function selectionDragOffset(state) {
  return boundedTimedSelectionOffset(state.row.words, state.indices, state.startTime + (state.x - state.startX) * TIMELINE_MS_PER_PIXEL - state.startTime, 10, state.row.time, state.maximum);
}
function paintSelectionDrag(state, offset) {
  for (const item of state.items) {
    item.node.style.transform = `translateX(${offset / TIMELINE_MS_PER_PIXEL}px)`;
    const label = item.node.querySelector('span');
    if (label) label.textContent = formatWordOffset(state.row, item.startTime + offset);
  }
}
function clearTimeDrag() {
  const state = dragState;
  if (!state) return;
  dragState = null;
  if (state.frame) cancelAnimationFrame(state.frame);
  for (const item of state.items) {
    item.node.style.transform = '';
    const label = item.node.querySelector('span');
    if (label) label.textContent = formatWordOffset(state.row, state.row.words[item.index]?.time);
  }
  document.removeEventListener('visibilitychange', state.visibility);
  if (state.node.hasPointerCapture(state.pointerId)) state.node.releasePointerCapture(state.pointerId);
}
function startTimeDrag(t, row, index, event) {
  if (t.authoritativeLrc || event.button !== 0) return;
  event.preventDefault(); clearTimeDrag();
  const indices = selectTimelineTokens(t, row, index, event);
  if (event.metaKey || event.ctrlKey || event.shiftKey || !indices.length) return;
  const rowIndex = t.rows.findIndex((item) => item._id === row._id);
  const node = event.currentTarget;
  const view = playbackView(t);
  const items = indices.map((item) => ({ index: item, startTime: Number(row.words[item].time), node: view.tokens[rowIndex]?.[item]?.querySelector('.eb-time-marker') || node }));
  const state = { t, row, index, indices, items, node, pointerId: event.pointerId, startX: event.clientX, startTime: Number(row.words[index].time), maximum: rowIndex >= 0 && t.rows[rowIndex + 1] ? Number(t.rows[rowIndex + 1].time) - 10 : Number.POSITIVE_INFINITY, x: event.clientX, frame: null, visibility: null };
  state.visibility = () => { if (document.hidden) finishTimeDrag(); }; dragState = state; node.setPointerCapture(event.pointerId); document.addEventListener('visibilitychange', state.visibility);
}
function moveTimeDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.x = event.clientX;
  if (!dragState.frame) dragState.frame = requestAnimationFrame(() => {
    const state = dragState;
    if (!state) return;
    paintSelectionDrag(state, selectionDragOffset(state));
    state.frame = null;
  });
}
function finishTimeDrag(event) {
  if (!dragState || (event?.pointerId != null && event.pointerId !== dragState.pointerId)) return;
  if (event?.clientX != null) dragState.x = event.clientX;
  const state = dragState;
  if (!allTracks().includes(trackOwner(state.t)) || !state.t.rows.includes(state.row)) return clearTimeDrag();
  const offset = selectionDragOffset(state);
  for (const item of state.items) state.row.words[item.index].time = item.startTime + offset;
  updateActiveIndices(state.t, playheadMs(state.t)); lockTiming(state.t); commitHistory(state.t); clearTimeDrag();
}
function normalizeRows(t) { t.rows.sort((a, b) => Number(a.time) - Number(b.time)); syncTrackText(t); }
function syncRowText(t, row) { row.words = reconcileWordCharacters(row.words, row.text, newId, row.time); t._textDirty = true; syncTrackText(t); lockTiming(t); }
function applyWholeText(t) { if (readOnly || trackOwner(t).authoritativeLrc) return; t.rows = reconcileTimedRows(t.rows, t.text, newId); normalizeRows(t); t.timingLocked = true; updateActiveIndices(t, playheadMs(t)); commitHistory(t); }
function recordCursor(row, event) { row._selection = { start: utf16ToCodePointIndex(row.text, event.target.selectionStart), end: utf16ToCodePointIndex(row.text, event.target.selectionEnd) }; }
function lockTiming(t) { t.timingLocked = true; t.untimed = false; }
function addLine(t, index) { if (readOnly || trackOwner(t).authoritativeLrc) return; const time = Math.max(0, Number(t.rows[index]?.time || 0) + 1000); t.rows.splice(index + 1, 0, { _id: newId(), time, text: '', words: [{ _id: newId(), time, text: '' }] }); syncTrackText(t); lockTiming(t); commitHistory(t); }
function removeLine(t, index) { if (readOnly || trackOwner(t).authoritativeLrc) return; t.rows.splice(index, 1); syncTrackText(t); lockTiming(t); commitHistory(t); }
function previewEnd(t) { const row = t.rows[t.rows.length - 1]; const word = row?.words?.[row.words.length - 1]; return Math.max(1000, Number(word?.time || row?.time || 0)) + 1500; }
function playbackView(t) {
  let view = playbackViews.get(t);
  if (!view) { view = { lines: [], tokens: [], progresses: [], activeLine: null, activeToken: null, activeLineIndex: -1, activeWordIndex: -1 }; playbackViews.set(t, view); }
  return view;
}
function bindLineNode(t, index, node) {
  const view = playbackView(t);
  view.lines[index] = node || null;
  if (node && index === view.activeLineIndex) { node.classList.add('active'); view.activeLine = node; }
}
function sentenceProgressPercent(t, line, ms) {
  const row = t.rows[line]; if (!row) return 0;
  const start = Number(row.time); const end = timedSentenceEndMs(row, nextRowTime(t, line));
  return Number.isFinite(start) && end > start ? Math.max(0, Math.min(100, ((Number(ms) - start) / (end - start)) * 100)) : 0;
}
function bindTokenNode(t, line, word, node) {
  const view = playbackView(t);
  if (!view.tokens[line]) view.tokens[line] = [];
  view.tokens[line][word] = node || null;
  if (node && line === view.activeLineIndex && word === view.activeWordIndex) {
    node.classList.add('active');
    view.activeToken = node;
  }
}
function bindRowProgressNode(t, line, node) {
  const view = playbackView(t); view.progresses[line] = node || null;
  if (node && line === view.activeLineIndex) node.style.setProperty('--eb-sentence-progress', `${sentenceProgressPercent(t, line, playheadMs(t))}%`);
}
function updateActiveIndices(t, ms = playheadMs(t)) {
  const view = playbackView(t);
  const line = activeIndexAt(t.rows, ms);
  const word = activeIndexAt(t.rows[line]?.words || [], ms);
  const previousLine = view.activeLineIndex;
  const nextLine = line >= 0 ? view.lines[line] : null;
  const nextToken = word >= 0 ? view.tokens[line]?.[word] : null;
  if (view.activeLine !== nextLine) {
    view.activeLine?.classList.remove('active');
    nextLine?.classList.add('active');
    view.activeLine = nextLine;
  }
  view.activeLineIndex = line;
  if (view.activeToken !== nextToken) {
    view.activeToken?.classList.remove('active');
    nextToken?.classList.add('active');
    view.activeToken = nextToken;
  }
  view.activeWordIndex = word;
  const progress = view.progresses[line];
  if (previousLine !== line) view.progresses.forEach((node, index) => { if (node && index !== line) node.style.removeProperty('--eb-sentence-progress'); });
  if (progress) progress.style.setProperty('--eb-sentence-progress', `${sentenceProgressPercent(t, line, ms)}%`);
}
function clearPlaybackView(t) {
  const view = playbackViews.get(t);
  if (!view) return;
  view.activeLine?.classList.remove('active');
  view.activeToken?.classList.remove('active');
  view.progresses.forEach((node) => node?.style.removeProperty('--eb-sentence-progress'));
  playbackViews.delete(t);
}
function trackOwner(t) { return t._owner || t; }
function playheadMs(t) { const track = trackOwner(t); return playheads.get(track) ?? (Number(track._previewMs) || 0); }
function bindProgressNode(t, node) { t._progressNode = node || null; updatePlaybackDom(t); }
function bindPlayerTimeNode(t, node) { t._playerTimeNode = node || null; updatePlaybackDom(t); }
function updatePlaybackDom(t) { const ms = playheadMs(t); if (t._progressNode) t._progressNode.value = String(ms); if (t._playerTimeNode) t._playerTimeNode.textContent = t._audioUrl && !t._audioErr ? `${formatMs(ms)} / ${formatMs(t._audioDuration)}` : formatMs(ms); }
function setPlayhead(t, ms, commit = false) { const track = trackOwner(t); const next = Math.max(0, Math.round(Number(ms) || 0)); playheads.set(track, next); updateAllVocalHighlights(track, next); updatePlaybackDom(track); if (commit) track._previewMs = next; }
function seekTrack(t, ms) { const end = t._audioUrl && !t._audioErr ? sourceEnd(t) : previewEnd(t); const next = Math.max(0, Math.min(end, Math.round(Number(ms) || 0))); setPlayhead(t, next, true); if (t._audioElement) t._audioElement.currentTime = next / 1000; }
function nudgePlayhead(t, delta) { seekTrack(t, playheadMs(t) + delta); }
function cancelSourceTimer(t) { if (t._sourceTimer) { clearInterval(t._sourceTimer); t._sourceTimer = null; } }
function allTracks() { return [track]; }
function hasHarmony(t) { return t._vocals.some((vocal, index) => index > 0 && vocal.rows.length); }
function vocalLabel(vocal, index) { return index === 0 ? '主唱' : '和声'; }
function vocalLaneClass(vocal, index) { return index === 0 ? 'main' : 'harmony'; }
function activateVocal(t, index) {
  persistVocal(t);
  const vocal = t._vocals[index]; if (!vocal) return;
  t._selectedVocal = index; t.head = vocal.head; t.rows = vocal.rows; t.text = vocal.text; t.timingLocked = vocal.timingLocked; t._view = vocal._view;
}
function openLineEditor(vocal) {
  vocal._view = 'lrc';
}
function ensureHarmonyVocal(t) {
  const existing = t._vocals.find((vocal, index) => index > 0);
  if (existing) return existing;
  const vocal = { id: 'harmony', name: '和声', head: [], rows: [], text: '', timingLocked: true, _view: 'lrc', _owner: t, _history: t._history };
  t._vocals.push(vocal);
  return vocal;
}
function harmonyRowIcon(vocal) { return vocal.id === 'main' ? '♫' : '↩'; }
function toggleHarmonyRow(vocal, row) {
  const t = trackOwner(vocal);
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  const sourceIndex = t._vocals.indexOf(vocal);
  const target = sourceIndex ? t._vocals[0] : ensureHarmonyVocal(t);
  const targetIndex = t._vocals.indexOf(target);
  const rowIndex = vocal.rows.findIndex((item) => item === row);
  if (targetIndex < 0 || rowIndex < 0) return;
  t._vocals = transferTimedVocalRow(t._vocals, sourceIndex, rowIndex, targetIndex);
  for (const part of t._vocals) { part._owner = t; part._history = t._history; part.name = part.id === 'main' ? '主唱' : '和声'; }
  t._vocals[targetIndex].timingLocked = true;
  t._vocals[targetIndex]._view = 'lrc';
  const source = t._vocals[Math.min(sourceIndex, t._vocals.length - 1)];
  t._selectedVocal = Math.min(sourceIndex, t._vocals.length - 1);
  t.head = source.head; t.rows = source.rows; t.text = source.text; t.timingLocked = source.timingLocked; t._view = source._view;
  lockTiming(t);
  commitHistory(t);
}
function updateAllVocalHighlights(t, ms) {
  for (const vocal of t._vocals) updateActiveIndices(vocal, ms);
}
function pausePreview(t) { t._playing = false; if (t._previewTimer) { clearInterval(t._previewTimer); t._previewTimer = null; } setPlayhead(t, playheadMs(t), true); }
function togglePreview(t) { if (t._playing) return pausePreview(t); for (const other of allTracks()) pausePreview(other); t._playing = true; let last = Date.now(); t._previewTimer = setInterval(() => { const now = Date.now(); const ms = Math.min(previewEnd(t), playheadMs(t) + (now - last) * t._speed); setPlayhead(t, ms); last = now; if (ms >= previewEnd(t)) pausePreview(t); }, 100); }
function releaseAllTracks() { clearTimeDrag(); historyTrack = null; for (const track of allTracks()) releaseAudio(track); }
function releaseAudio(t) {
  cancelSourceTimer(t); pausePreview(t);
  t._audioLoadId = (t._audioLoadId || 0) + 1;
  if (t._audioAbort) t._audioAbort.abort();
  if (t._audioElement) { t._audioElement.pause(); t._audioElement.src = ''; }
  playheads.delete(t); clearPlaybackView(t); t._audioElement = null; t._audioUrl = ''; t._audioLoading = false; t._audioAbort = null; t._audioErr = ''; t._audioDuration = 0; t._sourcePlaying = false; t._audioProgress = -1;
}
function bindAudioElement(t, node) { if (node) { t._audioElement = node; node.currentTime = playheadMs(t) / 1000; } else t._audioElement = null; }
function pauseSource(t) { if (t._audioElement) t._audioElement.pause(); t._sourcePlaying = false; cancelSourceTimer(t); setPlayhead(t, playheadMs(t), true); }
function sourceEnd(t) { return Math.max(1, Number(t._audioDuration) || previewEnd(t)); }
function setVolume(t) { if (t._audioElement) t._audioElement.volume = Number(t._volume); }
function setSourceRate(t) { if (t._audioElement) t._audioElement.playbackRate = Number(t._speed); }
function seekSource(t, event) {
  const ms = Number(event.target.value) || 0;
  setPlayhead(t, ms, true);
  if (t._audioElement) t._audioElement.currentTime = ms / 1000;
}
// 先取值再暂停：pausePreview 经 updatePlaybackDom 会把旧播放头写回同一个滑块
function seekPreview(t, event) { const ms = Number(event.target.value) || 0; pausePreview(t); setPlayhead(t, ms, true); }
async function toggleSource(t) {
  if (!audioUrl) return;
  await nextTick();
  const audio = t._audioElement;
  if (!audio) return;
  if (!audio.paused) { audio.pause(); return; }
  audio.volume = Number(t._volume);
  audio.playbackRate = Number(t._speed);
  try { await audio.play(); } catch (error) { sourcePlayError(t, error); }
}
function sourcePlay(t, event) {
  cancelSourceTimer(t);
  for (const other of allTracks()) { if (other !== t && other._audioElement) other._audioElement.pause(); pausePreview(other); }
  t._audioElement = event.target; t._sourcePlaying = true; pausePreview(t);
  let lastProgress = 0;
  const sync = () => {
    if (!t._sourcePlaying || !t._audioElement) return;
    const now = performance.now();
    const ms = Math.round(t._audioElement.currentTime * 1000);
    updateAllVocalHighlights(t, ms);
    if (now - lastProgress >= SOURCE_PROGRESS_INTERVAL_MS) {
      playheads.set(t, ms);
      updatePlaybackDom(t);
      lastProgress = now;
    }
  };
  sync();
  t._sourceTimer = setInterval(sync, SOURCE_CURSOR_INTERVAL_MS);
}
function sourcePause(t) { t._sourcePlaying = false; cancelSourceTimer(t); setPlayhead(t, t._audioElement ? Math.round(t._audioElement.currentTime * 1000) : playheadMs(t), true); }
function sourcePlayError(t, error) {
  if (error?.name === 'NotAllowedError') { t._audioErr = '浏览器阻止自动播放，请再次点击播放。'; return; }
  sourceError(t, { target: t._audioElement });
}
function sourceError(t, event) {
  pauseSource(t);
  t._sourcePlaying = false;
  t._audioLoading = false;
  const code = Number(event?.target?.error?.code || 0);
  t._audioErr = code === 3 ? '原音解码失败：文件格式或编码不受当前浏览器支持。' : code === 2 ? '原音播放网络错误。' : '原音播放失败，请重试。';
}
function sourceTime(t, event) { if (!t._sourcePlaying) setPlayhead(t, Math.round(event.target.currentTime * 1000)); }
function sourceReady(t, event) {
  t._audioElement = event.target;
  t._audioLoading = false;
  t._audioDuration = Math.round((Number(event.target.duration) || 0) * 1000);
  if (Math.abs(event.target.currentTime * 1000 - playheadMs(t)) > 20) event.target.currentTime = playheadMs(t) / 1000;
  event.target.volume = Number(t._volume);
  event.target.playbackRate = Number(t._speed);
}
function simplifyTrack(t) {
  if (readOnly || trackOwner(t).authoritativeLrc) return;
  sanitizeGeneratedTrack(t, toSimplified);
  // 保持已有 LRC/KLRC 的时间戳，只把文本改成简体；Phase B 不会重跑 STT。
  if (t.rows.length) lockTiming(t);
  else t._textDirty = true;
  commitHistory(t);
}
const formatMs = (ms) => msToTimestamp(ms);
const isLowConf = (value) => value.confidence != null && value.confidence < 0.7;
const showLowCov = (value) => Number(value.coverage) >= 0 && Number(value.coverage) < 0.7;
const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
const isDirty = () => !!track._history?.dirty || track._history?.index > 0;
const trackState = (value) => value.authoritativeLrc ? '权威歌词只读' : '可编辑';
function handleHistoryShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' || !historyTrack) return;
  event.preventDefault();
  if (event.shiftKey) redoTrack(historyTrack); else undoTrack(historyTrack);
}
watch(() => track, (next, previous) => { if (previous) releaseAudio(previous); clearTimeDrag(); closeTimelineMenu(); historyTrack = null; activeWorkbenchTrack = null; ensure(); }, { immediate: true, flush: 'sync' });
watch(() => audioUrl, (url) => { pauseSource(track); pausePreview(track); track._audioUrl = url; track._audioErr = ''; }, { immediate: true });
onMounted(() => { window.addEventListener('keydown', handleHistoryShortcut); window.addEventListener('keydown', handleWorkbenchKeydown); });
onBeforeUnmount(() => { clearTimeDrag(); releaseAudio(track); window.removeEventListener('keydown', handleHistoryShortcut); window.removeEventListener('keydown', handleWorkbenchKeydown); });
</script>

<style scoped>
.eb-track { padding:1rem; min-width:0; --eb-accent:var(--workspace-accent,var(--theme-color,#3a7afe)); }
.eb-dim { opacity:.6; }
.eb-workbench,.eb-editor-panel { min-width:0; }
.eb-input {
  width: 100%;
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: .9rem;
  box-sizing: border-box;
}
.eb-input:focus {
  outline: none;
  border-color: var(--eb-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--eb-accent) 22%, transparent);
}
.eb-input.tiny { width: 3.4rem; flex: none; text-align: center; }
.eb-input.output-name { width: min(14rem, 100%); flex: 1 1 9rem; }
.eb-input.sel { flex: none; max-width: 14rem; }
.eb-row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-top: .6rem; }
.grow { flex: 1; width: auto; min-width: 8rem; }

.eb-btn {
  padding: .45rem 1.1rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  cursor: pointer;
  background: transparent;
  color: inherit;
  font-size: .85rem;
  transition: transform .15s, border-color .15s;
}
.eb-btn:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--eb-accent); }
.eb-btn.primary { background: var(--eb-accent); border-color: var(--eb-accent); color: #fff; }
.eb-btn.big { padding: .55rem 1.6rem; font-size: .95rem; }
.eb-btn.small { padding: .25rem .7rem; font-size: .75rem; }
.eb-icon-btn { width: 2rem; height: 2rem; padding: 0; display: inline-grid; place-items: center; flex: none; }
.eb-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }
.eb-btn.danger { color: #f85149; }
.eb-btn.danger:hover:not(:disabled) { border-color: #f85149; }

.eb-track-head { display: flex; gap: .5rem; align-items: center; margin-bottom: .5rem; flex-wrap: wrap; }
.eb-track-title { flex: 1; min-width: 8rem; font-size: .95rem; }
.eb-tag {
  font-size: .72rem;
  border-radius: 99px;
  padding: .05rem .5rem;
  white-space: nowrap;
  border: 1px solid currentColor;
}
.eb-tag.conf { color: #e3a008; }
.eb-tag.cov { color: #a371f7; }
.eb-tag.edit { color: var(--eb-accent); }

.eb-track-bar { display: flex; gap: .4rem; align-items: center; margin-bottom: .5rem; font-size: .75rem; }
.eb-vocal-legend { display: flex; gap: .4rem; align-items: center; margin: 0 0 .5rem; font-size: .75rem; }
.eb-vocal-key, .eb-vocal-lane-label > span { display: inline-flex; align-items: center; gap: .28rem; font-weight: 650; }
.eb-vocal-key::before, .eb-vocal-lane-label > span::before { content: ''; width: .38rem; height: 1rem; border-radius: 99px; background: var(--eb-vocal-color); }
.eb-vocal-key.main, .eb-vocal-lane.main { --eb-vocal-color: var(--eb-accent); }
.eb-vocal-key.harmony, .eb-vocal-lane.harmony { --eb-vocal-color: #b96cff; }
.eb-vocal-lane { border-left: 3px solid var(--eb-vocal-color); padding-left: .55rem; margin: .7rem 0; }
.eb-vocal-lane-label { display: flex; justify-content: space-between; gap: .5rem; align-items: center; margin: 0 0 .35rem; font-size: .78rem; }
.eb-vocal-lane .eb-edit-switch { margin: 0; }
.eb-spacer { flex: 1; }
.eb-btn.on { border-color: var(--eb-accent); color: var(--eb-accent); }

.eb-lrc { font-size: .85rem; }
.eb-edit-switch { display: flex; gap: .4rem; margin: 0 0 .65rem; }
.eb-inline-player { display: flex; min-width: 0; align-items: center; margin: 0 0 .65rem; padding: .45rem .55rem; border: 1px solid var(--border-color, #ddd); border-radius: 4px; }
.eb-lrc-head {
  font-size: .75rem;
  opacity: .6;
  line-height: 1.6;
  padding: .3rem .5rem;
  margin-bottom: .35rem;
  border-left: 2px solid var(--border-color, #ddd);
}
.eb-lrc-row { display: flex; gap: .4rem; align-items: center; margin-bottom: .25rem; }
.eb-line-editor { margin-bottom: .65rem; padding: .4rem; border-left: 2px solid transparent; }
.eb-line-editor.active { border-color: var(--eb-accent); background: color-mix(in srgb, var(--eb-accent) 8%, transparent); }
.eb-preview { display: flex; flex: 1; min-width: 0; align-items: center; flex-wrap: wrap; gap: .45rem; font-size: .75rem; }
.eb-preview input[type="range"] { flex: 1; min-width: 8rem; }
.eb-player { display: flex; align-items: center; flex: 1; flex-wrap: wrap; gap: .45rem; }
.eb-player-progress { flex: 1; min-width: 8rem; }
.eb-player-time { min-width: 7.5rem; font-family: var(--font-family-mono, monospace); }
.eb-player label { display: flex; align-items: center; gap: .25rem; white-space: nowrap; }
.eb-player label input { width: 5rem; }
.eb-hidden-audio { display: none; }
.eb-simulation { min-width: 0; }
.eb-select { background: transparent; color: inherit; border: 1px solid var(--border-color, #ddd); border-radius: 5px; }
.eb-input.ms { width: 5.4rem; flex: none; font-family: var(--font-family-mono, monospace); }
.eb-time { display: flex; align-items: center; gap: .2rem; font-size: .7rem; white-space: nowrap; }
.eb-word-timeline { overflow-x: auto; padding: .4rem .2rem; contain: layout paint; border-top: 1px solid var(--border-color, #ddd); }
.eb-time-track { position: relative; display: flex; width: max(100%, var(--eb-timeline-width, 100%)); gap: 0; padding: 0 4rem 3px; box-sizing: border-box; }
.eb-time-lead { box-sizing: border-box; flex: var(--eb-time-grow, 0) 0 0; min-width: 0; border-right: 1px dashed color-mix(in srgb, var(--border-color, #ddd) 70%, transparent); }
.eb-time-token { position: relative; box-sizing: border-box; display: flex; flex: var(--eb-time-grow, 1) 0 0; min-width: max-content; flex-direction: column; justify-content: space-between; min-height: 3.2rem; white-space: nowrap; border-left: 1px solid color-mix(in srgb, var(--eb-accent) 45%, transparent); }
.eb-time-token.active { background: color-mix(in srgb, var(--eb-accent) 12%, transparent); }
.eb-time-token.selected { background: color-mix(in srgb, var(--eb-accent) 18%, transparent); outline: 1px solid color-mix(in srgb, var(--eb-accent) 70%, transparent); outline-offset: -1px; }
.eb-time-token.same-timestamp { background: color-mix(in srgb, var(--eb-accent) 9%, transparent); border-top: 2px solid color-mix(in srgb, var(--eb-accent) 65%, transparent); }
.eb-time-trailing { flex: var(--eb-time-grow, 0) 0 0; min-width: 0; border-left: 1px dashed color-mix(in srgb, var(--border-color, #ddd) 70%, transparent); }
.eb-time-sentence-progress { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; pointer-events: none; background: linear-gradient(to right, var(--eb-accent) var(--eb-sentence-progress, 0%), color-mix(in srgb, var(--border-color, #ddd) 65%, transparent) var(--eb-sentence-progress, 0%)); }
.eb-time-chars { display: flex; min-width: 2.4rem; min-height: 1.4rem; padding: .12rem .18rem; }
.eb-time-marker { align-self: flex-start; writing-mode: vertical-rl; padding: .15rem; border: 0; border-radius: 3px; background: transparent; color: var(--eb-accent); cursor: ew-resize; touch-action: none; font-size: .62rem; }
.eb-time-char { min-width: .8em; padding: .12rem .04rem; border-right: 1px dotted color-mix(in srgb, var(--border-color, #ddd) 75%, transparent); cursor: text; }
.eb-time-char:focus { outline: 1px solid var(--eb-accent); outline-offset: 1px; }
.eb-time-missing { align-self: stretch; min-width: 1.6rem; padding: .12rem .25rem; border: 0; border-left: 1px dashed color-mix(in srgb, var(--eb-accent) 65%, transparent); border-right: 1px dashed color-mix(in srgb, var(--eb-accent) 65%, transparent); background: color-mix(in srgb, var(--eb-accent) 8%, transparent); color: var(--eb-accent); cursor: copy; font: inherit; opacity: .8; }
.eb-time-missing:hover, .eb-time-missing:focus-visible { background: color-mix(in srgb, var(--eb-accent) 18%, transparent); opacity: 1; outline: 1px solid var(--eb-accent); outline-offset: -1px; }
.eb-timeline-menu { position: fixed; z-index: 4; display: flex; gap: .35rem; flex-wrap: wrap; max-width: min(22rem, calc(100vw - 1rem)); padding: .35rem; border: 1px solid var(--border-color, #ddd); border-radius: 6px; background: var(--bg-color, #fff); box-shadow: 0 .25rem .8rem rgb(0 0 0 / 15%); }
.eb-line-editor:not(.active) { content-visibility: auto; contain-intrinsic-size: auto 6rem; }
.eb-ts {
  font-family: var(--font-family-mono, monospace);
  font-size: .75rem;
  opacity: .6;
  white-space: nowrap;
  flex: none;
}
.eb-ts.miss { opacity: .35; }
.eb-input.lrc { padding: .3rem .5rem; font-size: .85rem; }
.eb-inst { font-size: .75rem; white-space: nowrap; display: flex; align-items: center; gap: .25rem; opacity: .8; }
.eb-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: .85rem;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
}
.eb-textarea:focus { outline: none; border-color: var(--eb-accent); }
@media (max-width: 720px) { .eb-track { padding: .5rem; } .eb-inline-player { align-items: stretch; } .eb-player-time { min-width: auto; } }


</style>
