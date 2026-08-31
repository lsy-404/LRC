<template>
  <div class="eb">
    <!-- 待处理投稿列表（免记 ref，点选即加载）-->
    <section v-if="pending.length" class="eb-card">
      <label class="eb-label">待处理投稿</label>
      <ul class="eb-pending">
        <li v-for="p in pending" :key="p.ref + '/' + p.storage_album" :class="{ processing: isProcessingPending(p) }">
          <button class="eb-pending-open" type="button" :disabled="!canOpenPending(p)" :aria-label="pendingAriaLabel(p)" @click="pick(p)">
            <span class="eb-p-album">{{ p.album }}</span>
            <span class="eb-p-meta" :title="p.message || pendingStageText(p)">
              {{ p.message || pendingStageText(p) }}<template v-if="p.progress != null"> {{ Math.round(p.progress) }}%</template><template v-if="!canOpenPending(p)"> · {{ pendingLockReason(p) }}</template> · {{ p.ref.slice(0, 7) }}<template v-if="p.contributor"> · @{{ p.contributor }}</template>
            </span>
          </button>
          <span class="eb-p-right">
            <button v-if="isFailedPending(p)" class="eb-btn small" :disabled="isRetryingPending(p)" @click.stop="retryPending(p)">
              {{ isRetryingPending(p) ? '重试中…' : '重试' }}
            </button>
            <button class="eb-btn small danger" :disabled="discarding || isProcessingPending(p)" @click="discard(p.ref, p.storage_album, p.album)">丢弃</button>
            <span v-if="pendingRetryMessage(p)" class="eb-msg inline" :class="{ err: pendingRetryError(p) }">{{ pendingRetryMessage(p) }}</span>
          </span>
        </li>
      </ul>
    </section>

    <!-- ref 选择（后备：手动粘贴编号）-->
      <section class="eb-card">
        <label class="eb-label">追踪编号（ref）</label>
        <div class="eb-row">
          <select v-if="recentRefs.length" v-model="refInput" class="eb-input sel">
            <option value="">— 最近投稿 —</option>
            <option v-for="c in recentRefs" :key="c.ref" :value="c.ref">
              {{ c.album }} · {{ c.ref.slice(0, 7) }}
            </option>
          </select>
          <input v-model="refInput" class="eb-input grow" placeholder="粘贴追踪编号（提交 SHA）">
          <button class="eb-btn primary" :disabled="loading || !refInput.trim()" @click="load()">
            {{ loading ? '加载中…' : '加载' }}
          </button>
        </div>
        <p v-if="msg" class="eb-msg" :class="{ err: msgErr }">{{ msg }}</p>
      </section>

      <section v-if="isProcessing" class="eb-card eb-progress-card" aria-live="polite">
        <div class="eb-progress-head">
          <h3>{{ jobStageText(jobInfo) }}</h3>
          <strong v-if="jobPercent !== null">{{ jobPercent }}%</strong>
          <span v-else class="eb-dim">处理中</span>
        </div>
        <div class="eb-progress-track" :class="{ unknown: jobPercent === null }">
          <span class="eb-progress-fill" :style="jobPercent === null ? undefined : { width: jobPercent + '%' }" />
        </div>
        <p class="eb-dim">{{ jobInfo.message || '正在处理投稿，请保持此页面打开以自动刷新状态。' }}</p>
        <p v-if="jobInfo.lastError" class="eb-dim">最近一次重试：{{ jobInfo.lastError }}</p>
      </section>

      <section v-else-if="jobInfo && jobInfo.state === 'failed'" class="eb-card eb-progress-card failed" role="alert">
        <h3>处理失败</h3>
        <p>{{ jobInfo.error || jobInfo.message || '处理器未能完成该投稿。' }}</p>
        <div class="eb-row">
          <button class="eb-btn" :disabled="retrying" @click="retryPhaseA">
            {{ retrying ? '重新启动中…' : '重新开始处理' }}
          </button>
        </div>
      </section>

      <section v-if="done && !isProcessing" class="eb-card done">
        <h3>已触发对齐入库</h3>
        <p>{{ jobInfo?.result?.pr ? `Phase B 已完成，已创建 PR #${jobInfo.result.pr}。` : 'Phase B 正在对齐并整理，稍后会开出 PR 供审核。' }}</p>
      </section>

      <!-- 逐专辑编辑 -->
      <section v-for="e in edits" :key="e._storageAlbum" class="eb-card rise">
        <label class="eb-flabel" :for="`album-${e._storageAlbum}`">专辑名称</label>
        <input :id="`album-${e._storageAlbum}`" v-model="e.album" class="eb-input eb-album" aria-label="专辑名称" @input="syncPendingDisplay(e)">

        <div class="eb-meta">
          <div v-for="f in META_FIELDS" :key="f.key" class="eb-field">
            <label class="eb-flabel">{{ f.label }}</label>
            <input v-model="e.meta[f.key]" class="eb-input" :placeholder="f.list ? '多个用、分隔' : ''">
          </div>
        </div>

        <div class="eb-track-select">
          <label :for="`track-${e._storageAlbum}`">曲目</label>
          <select :id="`track-${e._storageAlbum}`" v-model.number="e._selectedTrack" class="eb-select" @change="selectTrack(e)">
            <option v-for="(track, index) in e.tracks" :key="track._id" :value="index">{{ String(track.order).padStart(2, '0') }} · {{ track.title || '未命名曲目' }}</option>
          </select>
        </div>
        <div
          v-for="t in selectedTracks(e)"
          :key="t._id"
          class="eb-track"
          :class="{ lowconf: isLowConf(t), lowcov: showLowCov(t), dirty: isDirty(t) }"
          @focusin="setHistoryTrack(t, $event)"
          @focusout="clearHistoryTrack(t, $event)"
        >
          <div class="eb-track-head">
            <input v-model.number="t.order" type="number" class="eb-input tiny" title="序号" @input="markHistory(t)" @change="commitHistory(t)">
            <input v-model="t.title" class="eb-input grow" placeholder="曲名" @input="markHistory(t)" @blur="commitHistory(t)">
            <input v-model="t.outputName" class="eb-input output-name" placeholder="输出文件名" aria-label="输出文件名" @input="markHistory(t)" @blur="commitHistory(t)">
            <span v-if="isLowConf(t)" class="eb-tag conf" title="视觉分轨的识别置信度低，请重点核对曲名与归属">
              识别低置信 {{ pct(t.confidence) }}
            </span>
            <span v-if="showLowCov(t)" class="eb-tag cov" title="时间轴对齐覆盖率低，时间戳可能不准">
              对齐覆盖 {{ pct(t.coverage) }}
            </span>
            <span v-if="t.authoritativeLrc" class="eb-tag" title="上传的 LRC 原文与行时间戳受保护；仅补充逐字侧车和元数据">
              权威 LRC
            </span>
            <span v-if="isDirty(t)" class="eb-tag edit" title="确认后 Phase B 会对该轨重新对齐">
              已修改 · 待重对齐
            </span>
            <label class="eb-inst"><input v-model="t.inst" type="checkbox" @change="commitHistory(t)"> 伴奏/无人声</label>
            <input v-if="t.inst" v-model="t.finalName" class="eb-input output-name" placeholder="最终文件名" aria-label="最终文件名" @input="markHistory(t)" @blur="commitHistory(t)">
          </div>

          <div class="eb-track-bar">
            <span class="eb-dim">{{ trackState(t) }}</span>
            <span class="eb-spacer" />
            <button class="eb-btn small" :disabled="t.authoritativeLrc" @click="simplifyTrack(t)">转简体/清理水印</button>
            <button class="eb-btn small" :disabled="t.authoritativeLrc || !canUndo(t)" @click="undoTrack(t)">撤回</button>
            <button class="eb-btn small" :disabled="t.authoritativeLrc || !canRedo(t)" @click="redoTrack(t)">恢复</button>
          </div>

          <div class="eb-vocal-legend" aria-label="主唱与和声图例">
            <span class="eb-vocal-key main">主唱</span>
            <span v-if="hasHarmony(t)" class="eb-vocal-key harmony">和声</span>
          </div>

          <div
            :ref="(node) => bindWorkbenchNode(t, node)"
            class="eb-workbench"
            data-workbench="true"
            tabindex="0"
            aria-label="歌词校对工作区"
            @focusin="setWorkbenchFocus(t)"
            @pointerdown="setWorkbenchFocus(t)"
          >
            <div class="eb-editor-panel">
              <div class="eb-inline-player">
              <div v-if="t.audio" class="eb-preview">
              <span v-if="t._audioLoading" class="eb-dim">载入原曲…<template v-if="t._audioProgress >= 0"> {{ t._audioProgress }}%</template></span>
              <div v-else-if="t._audioUrl && !t._audioErr" class="eb-player" aria-label="播放器">
                <button class="eb-btn small" @click="toggleSource(t)">{{ t._sourcePlaying ? '暂停' : '播放' }}</button>
                <input :ref="(node) => bindProgressNode(t, node)" class="eb-player-progress" :value="t._previewMs" type="range" min="0" :max="sourceEnd(t)" aria-label="播放进度" @input="seekSource(t, $event)">
                <span :ref="(node) => bindPlayerTimeNode(t, node)" class="eb-player-time">{{ formatMs(t._previewMs) }} / {{ formatMs(t._audioDuration) }}</span>
                <label>音量 <input v-model.number="t._volume" type="range" min="0" max="1" step="0.05" @input="setVolume(t)"></label>
                <label>速度 <select v-model.number="t._speed" class="eb-select" @change="setSourceRate(t)"><option v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate">{{ rate }}×</option></select></label>
              </div>
              <button v-else class="eb-btn small" @click="retryAudio(t)">重试</button>
              <span v-if="t._audioErr" class="eb-msg inline err">{{ t._audioErr }}</span>
              </div>
              <div v-if="(!t._audioUrl && !t._audioLoading) || t._audioErr" class="eb-preview eb-simulation">
              <button class="eb-btn small" @click="togglePreview(t)">{{ t._playing ? '暂停' : '播放' }}</button>
              <label>速度 <select v-model.number="t._speed" class="eb-select"><option v-for="rate in PLAYBACK_RATES" :key="rate" :value="rate">{{ rate }}×</option></select></label>
              <input :ref="(node) => bindProgressNode(t, node)" :value="t._previewMs" type="range" min="0" :max="previewEnd(t)" aria-label="播放进度" @input="seekPreview(t, $event)">
              <span :ref="(node) => bindPlayerTimeNode(t, node)">{{ formatMs(t._previewMs) }}</span>
              </div>
              </div>
              <div v-for="(vocal, vi) in t._vocals" :key="vocal.id" class="eb-vocal-lane" :class="vocalLaneClass(vocal, vi)">
              <div class="eb-vocal-lane-label"><span>{{ vocalLabel(vocal, vi) }}</span><div class="eb-edit-switch"><button class="eb-btn small" :class="{ on: vocal._view === 'lrc' }" @click="openLineEditor(vocal)">逐行与逐字</button><button class="eb-btn small" :class="{ on: vocal._view === 'text' }" @click="vocal._view = 'text'">整段文本</button></div></div>
              <div v-if="vocal.head.length" class="eb-lrc-head"><div v-for="(h, hi) in vocal.head" :key="hi">{{ h }}</div></div>
              <div v-if="vocal._view === 'lrc'">
              <div v-for="(r, li) in vocal.rows" :key="r._id" :ref="(node) => bindLineNode(vocal, li, node)" class="eb-line-editor" @focusin="activateVocal(t, vi)">
              <div class="eb-lrc-row">
                <label class="eb-time"><input v-model.number="r.time" type="number" min="0" step="10" class="eb-input ms" :readonly="t.authoritativeLrc" @focus="beginRowTimeEdit(r)" @input="shiftRowTime(vocal, r)" @change="finishRowTimeEdit(vocal, r)" @blur="finishRowTimeEdit(vocal, r)">毫秒</label>
                <input v-model="r.text" class="eb-input lrc" :readonly="t.authoritativeLrc" @input="syncRowText(vocal, r); markHistory(vocal)" @blur="commitHistory(vocal)" @click="recordCursor(r, $event)" @keyup="recordCursor(r, $event)" @select="recordCursor(r, $event)">
                <button class="eb-btn small eb-icon-btn" :disabled="t.authoritativeLrc || textRowBoundaryAction(r, li) === 'none'" :aria-label="textRowBoundaryLabel(r, li)" :title="textRowBoundaryLabel(r, li)" @click="applyTextRowBoundary(vocal, r, li)">{{ textRowBoundaryIcon(r, li) }}</button><button class="eb-btn small eb-icon-btn" :disabled="t.authoritativeLrc" aria-label="插入歌词行" title="插入歌词行" @click="addLine(vocal, li)">＋</button><button class="eb-btn small eb-icon-btn" :disabled="t.authoritativeLrc" :aria-label="vi ? '并回主唱' : '标为和声'" :title="vi ? '并回主唱' : '标为和声'" @click="toggleHarmonyRow(vocal, r)">{{ harmonyRowIcon(vocal) }}</button><button class="eb-btn small danger eb-icon-btn" :disabled="t.authoritativeLrc" aria-label="删除歌词行" title="删除歌词行" @click="removeLine(vocal, li)">×</button>
              </div>
              <div class="eb-word-timeline" role="region" aria-label="逐字时间轨">
                <div class="eb-time-track" :style="timelineTrackStyle(vocal, r, li)">
                  <span class="eb-time-lead" :style="timelineLeadStyle(r)" aria-hidden="true" />
                  <button v-for="slot in missingMarkerSlots(r, 0)" :key="`missing-${r._id}-${slot.textIndex}`" class="eb-time-missing" :disabled="t.authoritativeLrc" :title="`为 ${slot.text} 新增时间标记`" :aria-label="`为 ${slot.text} 新增时间标记`" @click="insertMissingMarker(vocal, r, li, slot.textIndex)">{{ slot.text }}</button>
                  <template v-for="(word, wi) in r.words" :key="word._id">
                  <div :ref="(node) => bindTokenNode(vocal, li, wi, node)" class="eb-time-token" :class="timelineTokenClass(r, wi)" :style="timelineTokenStyle(vocal, r, li, wi)">
                    <span class="eb-time-chars" :contenteditable="t.authoritativeLrc ? 'false' : 'plaintext-only'" spellcheck="false" tabindex="0" :aria-label="timelineTokenLabel(r, wi)" @focus="selectTimelineChar" @input="editTimelineChar(vocal, r, wi, $event)" @keydown="openTimelineMenuFromKey(vocal, r, wi, 0, $event)" @keydown.enter.prevent="$event.currentTarget.blur()"><span v-for="(char, ci) in Array.from(word.text)" :key="`${word._id}-${ci}`" class="eb-time-char" @contextmenu.prevent.stop="!t.authoritativeLrc && openTimelineMenu(vocal, r, wi, ci, $event)">{{ char }}</span></span>
                    <button class="eb-time-marker" :disabled="t.authoritativeLrc" :aria-label="`调整 ${word.text} 的句内偏移`" @pointerdown="startTimeDrag(vocal, r, wi, $event)" @pointermove="moveTimeDrag($event)" @pointerup="finishTimeDrag($event)" @pointercancel="finishTimeDrag($event)" @lostpointercapture="finishTimeDrag($event)" @contextmenu.prevent.stop="openTimelineMenu(vocal, r, wi, 0, $event)" @keydown="nudgeWordTime(vocal, r, wi, $event)"><span>{{ formatWordOffset(r, word.time) }}</span></button>
                  </div>
                  <button v-for="slot in missingMarkerSlots(r, wi + 1)" :key="`missing-${r._id}-${slot.textIndex}`" class="eb-time-missing" :disabled="t.authoritativeLrc" :title="`为 ${slot.text} 新增时间标记`" :aria-label="`为 ${slot.text} 新增时间标记`" @click="insertMissingMarker(vocal, r, li, slot.textIndex)">{{ slot.text }}</button>
                  </template>
                  <span class="eb-time-trailing" :style="timelineTrailingStyle(vocal, r, li)" aria-hidden="true" />
                  <span :ref="(node) => bindRowProgressNode(vocal, li, node)" class="eb-time-sentence-progress" aria-hidden="true" />
                </div>
              </div>
              <div v-if="timelineMenu && timelineMenu.rowId === r._id && timelineMenu.t === vocal" class="eb-timeline-menu" role="menu" :style="{ left: `${timelineMenu.x}px`, top: `${timelineMenu.y}px` }" @keydown.esc="closeTimelineMenu">
                <button v-if="timelineMenu.charIndex || timelineMenu.wordIndex" role="menuitem" class="eb-btn small" :disabled="t.authoritativeLrc" :title="timelineMenu.charIndex ? '新增此处的时间标签' : '删除当前时间标签（并入前字）'" @click.stop="applyTimelineBoundary">{{ timelineMenu.charIndex ? '在此新增时间标签' : '删除当前时间标签（并入前字）' }}</button>
                <button role="menuitem" class="eb-btn small" :disabled="t.authoritativeLrc || timelineBoundaryAction(timelineMenu) === 'none'" @click.stop="applyRowBoundary">{{ timelineBoundaryLabel(timelineMenu) }}</button>
              </div>
            </div>
              <button class="eb-btn small" :disabled="t.authoritativeLrc" @click="addLine(vocal, vocal.rows.length - 1)">新增歌词行</button>
              </div>
              <textarea
                v-else
              v-model="vocal.text"
              class="eb-textarea"
              rows="6"
              :readonly="t.authoritativeLrc"
              @input="markHistory(vocal)"
              @change="applyWholeText(vocal)"
              @blur="commitHistory(vocal)"
              :placeholder="t.inst ? '伴奏轨：留空则借同名正曲时间轴或写占位' : '逐行歌词'"
              />
              <button v-if="vocal._view === 'text'" class="eb-btn small" :disabled="t.authoritativeLrc" @click="applyWholeText(vocal)">应用整段文本并保留时间轴</button>
            </div>
            </div>
          </div>
          <audio
            v-if="t._audioUrl"
            :ref="(node) => bindAudioElement(t, node)"
            class="eb-hidden-audio"
            :src="t._audioUrl"
            preload="auto"
            @play="sourcePlay(t, $event)"
            @pause="sourcePause(t)"
            @ended="sourcePause(t)"
            @error="sourceError(t)"
            @loadedmetadata="sourceReady(t, $event)"
            @durationchange="sourceReady(t, $event)"
            @timeupdate="sourceTime(t, $event)"
          />
        </div>

        <details v-if="e.pages.length" class="eb-pages">
          <summary>OCR 原文（{{ e.pages.length }} 页 · 只读参考）</summary>
          <div v-for="p in e.pages" :key="p.name" class="eb-page">
            <b>{{ p.name }}</b>
            <pre>{{ p.text }}</pre>
          </div>
        </details>

        <div class="eb-cover">
          <img v-if="e._coverPreview" :src="e._coverPreview" class="eb-cover-thumb" alt="新封面预览">
          <span class="eb-dim">
            封面：{{ e.coverRemoved ? '将移除' : (e.coverExt ? (e._coverNew ? '新 ' : '已选 ') + 'cover' + e.coverExt : '无') }}
          </span>
          <label class="eb-btn small">
            更换<input type="file" accept="image/*" hidden @change="pickCover(e, $event)">
          </label>
          <button v-if="e.coverExt && !e.coverRemoved" class="eb-btn small" @click="removeCover(e)">移除</button>
          <button v-if="e.coverRemoved" class="eb-btn small" @click="e.coverRemoved = false">撤销移除</button>
          <span v-if="e._coverBusy" class="eb-dim">上传中…</span>
        </div>

        <div class="eb-row">
          <button class="eb-btn" :disabled="e._saving" @click="save(e)">
            {{ e._saving ? '保存中…' : '保存修改' }}
          </button>
          <button class="eb-btn danger" :disabled="discarding" @click="discard(curRef, e._storageAlbum, e.album)">
            {{ discarding ? '丢弃中…' : '丢弃此草稿' }}
          </button>
          <span v-if="e._msg" class="eb-msg inline" :class="{ err: e._err }">{{ e._msg }}</span>
        </div>
      </section>

      <section v-if="edits.length && !done" class="eb-card">
        <button class="eb-btn primary big" :disabled="continuing" @click="continueIngest()">
          {{ continuing ? '触发中…' : '确认并继续（对齐入库）' }}
        </button>
      </section>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import OpenCC from 'opencc-js/t2cn';
import { stripFlacPictureBlocks } from '../lib/flac.js';
import { readRefs, removeRef, dedupeRecent } from './refsCache.js';
import {
  activeIndexAt, clampWordTime, expandTimedTokens, fillInstrumentalFallback, insertMissingTimedCharacter, mergeTimedRows, mergeTimedToken, missingTimedCharacterSlots, parseLrc, parseKaraokeRows, parseVocalDrafts, reconcileTimedRows, reconcileWordCharacters, removeKnownSttWatermarks, removeKnownSttWatermarkTokens, replaceTimedTokenText, serializeTimedLyrics, serializeVocalDrafts, shiftTimedRow, splitTimedRow, splitTimedToken, splitRowAtTokenBoundary, textToLines, linesToText, timedLastTokenSpanMs, timedSentenceEndMs, timedTokenLayout, timedTrailingGapMs, timedRowBoundaryAction, transferTimedVocalRow, utf16ToCodePointIndex, isTrackEdited, isLowCoverage, msToTimestamp,
} from './lrcDraft.js';
import { canRedoLyricHistory, canUndoLyricHistory, createLyricHistory, markLyricHistoryDirty, recordLyricHistory, redoLyricHistory, undoLyricHistory } from './lyricHistory.js';

const META_FIELDS = [
  { key: 'vocal', label: '演唱', list: true },
  { key: 'lyricist', label: '作词', list: true },
  { key: 'composer', label: '作曲', list: true },
  { key: 'arranger', label: '编曲', list: true },
  { key: 'tuning', label: '调校', list: true },
  { key: 'illustrator', label: '曲绘', list: true },
  { key: 'mixer', label: '混音', list: true },
  { key: 'mastering', label: '母带', list: true },
  { key: 'video', label: '视频', list: true },
  { key: 'planning', label: '策划', list: true },
  { key: 'produce', label: '出品', list: true },
  { key: 'lyric_maker', label: '歌词制作', list: true },
  { key: 'year', label: '发行日期', list: false },
  { key: 'release', label: '发布', list: false },
  { key: 'purchase', label: '购买', list: false },
];

// 验证在工作站根层（Workbench）统一完成，密码经 prop 传入
const props = defineProps({ password: { type: String, default: '' } });
const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
const PLAYBACK_RATES = [0.1, 0.25, 0.5, 1, 1.5, 2];
const SOURCE_CURSOR_INTERVAL_MS = 40;
const SOURCE_PROGRESS_INTERVAL_MS = 80;

const cachedRefs = ref([]);
const pending = ref([]);
const refInput = ref('');
const curRef = ref('');
const loading = ref(false);
const msg = ref('');
const msgErr = ref(false);
const edits = ref([]);
const continuing = ref(false);
const discarding = ref(false);
const done = ref(false);
const jobInfo = ref(null);
const retrying = ref(false);
const pendingRetryState = ref({});
const timelineMenu = ref(null);
let pollTimer = null;
let pendingPollTimer = null;
let nextEditorId = 1;
let dragState = null;
let historyTrack = null;
const rowTimeEdits = new WeakMap();
const playheads = new WeakMap();
const playbackViews = new WeakMap();
const workbenchTracks = new WeakMap();
let activeWorkbenchTrack = null;

const recentRefs = computed(() => dedupeRecent(cachedRefs.value, pending.value));

function authHeaders() {
  return { authorization: 'Bearer ' + encodeURIComponent(props.password) };
}

function loadCachedRefs() {
  cachedRefs.value = readRefs();
}

const PHASE_TEXT = { A_done: '待修改', confirmed: '已确认待入库', B_done: '已入库' };
const phaseText = (s) => PHASE_TEXT[s] || s || '处理中';
const ACTIVE_JOB_STATES = new Set(['queued', 'dispatching', 'running']);
const STAGE_TEXT = {
  queued: '已排队', starting: '正在启动处理器', retrying: '正在重试',
  downloading: '正在读取原料', cloning: '正在准备处理脚本',
  processing: '正在识别、转写与对齐', writing_review: '正在写入审核草稿',
  loading_review: '正在读取审核草稿', aligning: '正在对齐并整理歌词',
  metadata: '正在补充发布信息', opening_pr: '正在创建审核请求',
  awaiting_review: '初稿已生成，等待人工审核', done: '处理完成', failed: '处理失败',
};
function pendingStageText(item) { return STAGE_TEXT[item?.stage] || phaseText(item?.status); }
function isProcessingPending(item) { return ACTIVE_JOB_STATES.has(item?.state) || item?.status === 'processing'; }
function isFailedPending(item) { return item?.state === 'failed' || item?.status === 'failed'; }
function canOpenPending(item) { return !isProcessingPending(item) && item?.state !== 'failed' && item?.status !== 'failed'; }
function pendingRetryKey(item) { return `${item?.ref || ''}/${item?.storage_album || ''}`; }
function pendingRetryEntry(item) { return pendingRetryState.value[pendingRetryKey(item)] || {}; }
function isRetryingPending(item) { return !!pendingRetryEntry(item).busy; }
function pendingRetryMessage(item) { return pendingRetryEntry(item).message || ''; }
function pendingRetryError(item) { return !!pendingRetryEntry(item).error; }
function pendingLockReason(item) { return isProcessingPending(item) ? '处理中，暂不可编辑' : '处理失败，暂不可编辑'; }
function pendingAriaLabel(item) {
  const detail = `${item.message || pendingStageText(item)}${item.progress != null ? ` ${Math.round(item.progress)}%` : ''}`;
  return `${item.album || '未命名投稿'}：${detail}${canOpenPending(item) ? '' : `，${pendingLockReason(item)}`}`;
}
const isProcessing = computed(() => ACTIVE_JOB_STATES.has(jobInfo.value?.state));
const jobPercent = computed(() => {
  const n = Number(jobInfo.value?.progress);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
});
function jobStageText(job) {
  if (!job) return '处理中';
  return STAGE_TEXT[job.stage] || (job.phase === 'phase_b' ? '正在对齐入库' : '正在处理投稿');
}

// 视觉分轨每轨置信度，低于 0.7 高亮提示重点核对
const isLowConf = (t) => t.confidence != null && t.confidence < 0.7;
// 时间轴对齐覆盖率，与识别置信度分开提示
const showLowCov = (t) => isLowCoverage(t.coverage);
const pct = (v) => Math.round((Number(v) || 0) * 100) + '%';

const newId = () => nextEditorId++;
const TIMELINE_MS_PER_PIXEL = 5;
const TIMELINE_PADDING_PX = 64;
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
  const last = row.words[row.words.length - 1];
  const rowEnd = Number(last?.time) + timedLastTokenSpanMs(row, nextRowTime(t, rowIndex));
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
  const duration = timedTrailingGapMs(row, next);
  return { '--eb-time-grow': Math.max(0, Number(duration) || 0) };
}
function missingMarkerSlots(row, wordIndex) { return missingTimedCharacterSlots(row).filter((slot) => slot.wordIndex === wordIndex); }
function insertMissingMarker(t, row, rowIndex, textIndex) {
  if (t.authoritativeLrc) return;
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
  if (t.authoritativeLrc) return;
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
function markHistory(t) { markLyricHistoryDirty(trackOwner(t)._history); }
function commitHistory(t) { const track = trackOwner(t); if (track !== t) activateVocal(track, track._vocals.indexOf(t)); recordLyricHistory(track._history, track); }
function restoreHistory(t, restore) {
  if (!restore(t._history, t)) return;
  for (const vocal of t._vocals) { vocal._owner = t; vocal._history = t._history; vocal.name = vocal.id === 'main' ? '主唱' : '和声'; }
  closeTimelineMenu(); clearPlaybackView(t);
  nextTick(() => updateAllVocalHighlights(t, playheadMs(t)));
}
function undoTrack(t) { const track = trackOwner(t); if (!track.authoritativeLrc) restoreHistory(track, undoLyricHistory); }
function redoTrack(t) { const track = trackOwner(t); if (!track.authoritativeLrc) restoreHistory(track, redoLyricHistory); }
function setWordTime(t, row, index, time) { if (t.authoritativeLrc) return; row.words[index].time = boundedWordTime(t, row, index, time); updateActiveIndices(t, playheadMs(t)); lockTiming(t); commitHistory(t); }
function beginRowTimeEdit(row) { rowTimeEdits.set(row, Number(row.time) || 0); }
function shiftRowTime(t, row) {
  if (t.authoritativeLrc) return;
  const previous = rowTimeEdits.has(row) ? rowTimeEdits.get(row) : Number(row.time) || 0;
  const shifted = shiftTimedRow(row, row.time, previous);
  row.time = shifted.time;
  row.words = shifted.words;
  rowTimeEdits.set(row, row.time);
  if (row.time !== previous) { markHistory(t); lockTiming(t); }
}
function finishRowTimeEdit(t, row) {
  if (t.authoritativeLrc) return;
  rowTimeEdits.delete(row);
  normalizeRows(t);
  lockTiming(t);
  updateActiveIndices(t, playheadMs(t));
  commitHistory(t);
}
function nudgeWordTime(t, row, index, event) { if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || t.authoritativeLrc) return; event.preventDefault(); setWordTime(t, row, index, Number(row.words[index].time) + (event.key === 'ArrowLeft' ? -10 : 10)); }
function closeTimelineMenu() { timelineMenu.value = null; }
function openTimelineMenu(t, row, wordIndex, charIndex, event) { if (t.authoritativeLrc) return; const x = Math.max(8, Math.min(window.innerWidth - 240, Number(event.clientX) || 8)); const y = Math.max(8, Math.min(window.innerHeight - 120, Number(event.clientY) || 8)); timelineMenu.value = { t, row, rowId: row._id, wordIndex, charIndex, rowIndex: t.rows.findIndex((item) => item._id === row._id), x, y }; nextTick(() => document.querySelector('.eb-timeline-menu [role="menuitem"]:not([disabled])')?.focus()); }
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
  if (t.authoritativeLrc) return;
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
function clearTimeDrag() {
  const state = dragState;
  if (!state) return;
  dragState = null;
  if (state.frame) cancelAnimationFrame(state.frame);
  state.node.style.transform = '';
  const label = state.node.querySelector('span');
  if (label) label.textContent = formatWordOffset(state.row, state.row.words[state.index]?.time);
  document.removeEventListener('visibilitychange', state.visibility);
  if (state.node.hasPointerCapture(state.pointerId)) state.node.releasePointerCapture(state.pointerId);
}
function startTimeDrag(t, row, index, event) { if (t.authoritativeLrc || event.button !== 0) return; event.preventDefault(); clearTimeDrag(); const node = event.currentTarget; const state = { t, row, index, node, pointerId: event.pointerId, startX: event.clientX, startTime: Number(row.words[index].time), x: event.clientX, frame: null, visibility: null }; state.visibility = () => { if (document.hidden) finishTimeDrag(); }; dragState = state; node.setPointerCapture(event.pointerId); document.addEventListener('visibilitychange', state.visibility); }
function moveTimeDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.x = event.clientX;
  if (!dragState.frame) dragState.frame = requestAnimationFrame(() => {
    const state = dragState;
    if (!state) return;
    const time = boundedWordTime(state.t, state.row, state.index, state.startTime + (state.x - state.startX) * TIMELINE_MS_PER_PIXEL);
    state.node.style.transform = `translateX(${(time - state.startTime) / TIMELINE_MS_PER_PIXEL}px)`;
    const label = state.node.querySelector('span');
    if (label) label.textContent = formatWordOffset(state.row, time);
    state.frame = null;
  });
}
function finishTimeDrag(event) { if (!dragState || (event?.pointerId != null && event.pointerId !== dragState.pointerId)) return; if (event?.clientX != null) dragState.x = event.clientX; const state = dragState; if (!allTracks().includes(trackOwner(state.t)) || !state.t.rows.includes(state.row)) return clearTimeDrag(); setWordTime(state.t, state.row, state.index, state.startTime + (state.x - state.startX) * TIMELINE_MS_PER_PIXEL); clearTimeDrag(); }
function normalizeRows(t) { t.rows.sort((a, b) => Number(a.time) - Number(b.time)); syncTrackText(t); }
function syncRowText(t, row) { row.words = reconcileWordCharacters(row.words, row.text, newId, row.time); t._textDirty = true; syncTrackText(t); lockTiming(t); }
function applyWholeText(t) { if (t.authoritativeLrc) return; t.rows = reconcileTimedRows(t.rows, t.text, newId); normalizeRows(t); t.timingLocked = true; updateActiveIndices(t, playheadMs(t)); commitHistory(t); }
function recordCursor(row, event) { row._selection = { start: utf16ToCodePointIndex(row.text, event.target.selectionStart), end: utf16ToCodePointIndex(row.text, event.target.selectionEnd) }; }
function lockTiming(t) { t.timingLocked = true; t.untimed = false; }
function addLine(t, index) { if (t.authoritativeLrc) return; const time = Math.max(0, Number(t.rows[index]?.time || 0) + 1000); t.rows.splice(index + 1, 0, { _id: newId(), time, text: '', words: [{ _id: newId(), time, text: '' }] }); syncTrackText(t); lockTiming(t); commitHistory(t); }
function removeLine(t, index) { if (t.authoritativeLrc) return; t.rows.splice(index, 1); syncTrackText(t); lockTiming(t); commitHistory(t); }
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
function allTracks() { return edits.value.flatMap((edit) => edit.tracks); }
function selectedVocal(t) { return t._vocals[t._selectedVocal] || t._vocals[0]; }
function hasHarmony(t) { return t._vocals.some((vocal, index) => index > 0 && vocal.rows.length); }
function vocalLabel(vocal, index) { return index === 0 ? '主唱' : '和声'; }
function vocalLaneClass(vocal, index) { return index === 0 ? 'main' : 'harmony'; }
function persistVocal(t) {
  const vocal = selectedVocal(t); if (!vocal) return;
  vocal.head = t.head; vocal.rows = t.rows; vocal.text = t.text; vocal.timingLocked = t.timingLocked; vocal._view = t._view;
}
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
  if (t.authoritativeLrc) return;
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
  if (t._audioUrl) URL.revokeObjectURL(t._audioUrl);
  playheads.delete(t); clearPlaybackView(t); t._audioElement = null; t._audioUrl = ''; t._audioLoading = false; t._audioAbort = null; t._audioErr = ''; t._audioDuration = 0; t._sourcePlaying = false; t._audioProgress = -1;
}
function bindAudioElement(t, node) { if (node) { t._audioElement = node; node.currentTime = playheadMs(t) / 1000; } else t._audioElement = null; }
function isCurrentAudioLoad(t, controller, loadId) { return t._audioAbort === controller && t._audioLoadId === loadId; }
async function fullAudioBlob(resp, t, controller, loadId) {
  const type = resp.headers.get('content-type') || 'application/octet-stream';
  const total = Number(resp.headers.get('content-length'));
  if (!resp.body || !Number.isFinite(total) || total <= 0) return new Blob([await resp.arrayBuffer()], { type });
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  let lastProgressAt = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.byteLength;
    const now = performance.now();
    if (isCurrentAudioLoad(t, controller, loadId) && now - lastProgressAt >= 150) {
      t._audioProgress = Math.min(99, Math.round((received / total) * 100));
      lastProgressAt = now;
    }
  }
  if (isCurrentAudioLoad(t, controller, loadId)) t._audioProgress = 100;
  return new Blob(chunks, { type });
}
async function loadAudio(t) {
  if (!t.audio || t._audioLoading) return;
  if (t._audioUrl) return;
  const controller = new AbortController();
  const loadId = (t._audioLoadId || 0) + 1;
  t._audioLoadId = loadId;
  t._audioAbort = controller;
  t._audioLoading = true; t._audioErr = ''; t._audioProgress = -1;
  try {
    const q = new URLSearchParams({ ref: curRef.value, name: t.audio });
    const resp = await fetch(`/api/ingest/audio?${q}`, { headers: authHeaders(), signal: controller.signal });
    if (resp.status !== 200) throw new Error(resp.status === 404 ? '原音已过期或不存在' : `服务器只返回了 ${resp.status}，原曲未完整下载`);
    const blob = await stripFlacPictureBlocks(await fullAudioBlob(resp, t, controller, loadId));
    if (!blob.size) throw new Error('原曲文件为空');
    if (isCurrentAudioLoad(t, controller, loadId)) t._audioUrl = URL.createObjectURL(blob);
  } catch (error) { if (error?.name !== 'AbortError' && isCurrentAudioLoad(t, controller, loadId)) { t._audioErr = `原音下载失败：${error.message || '读取失败'}`; t._audioLoading = false; } }
  finally { if (isCurrentAudioLoad(t, controller, loadId)) { t._audioAbort = null; if (!t._audioUrl) t._audioLoading = false; } }
}
function selectedTracks(e) { const track = e.tracks[e._selectedTrack]; return track ? [track] : []; }
async function selectTrack(e) {
  clearTimeDrag();
  const current = e.tracks[e._selectedTrack];
  for (const track of e.tracks) { if (track !== current) releaseAudio(track); else { pauseSource(track); pausePreview(track); } }
  if (current) await loadAudio(current);
}
async function retryAudio(t) {
  if (t._audioErr && t._audioUrl) releaseAudio(t);
  t._audioErr = '';
  await loadAudio(t);
}
function pauseSource(t) { if (t._audioElement) t._audioElement.pause(); t._sourcePlaying = false; cancelSourceTimer(t); setPlayhead(t, playheadMs(t), true); }
function sourceEnd(t) { return Math.max(1, Number(t._audioDuration) || previewEnd(t)); }
function setVolume(t) { if (t._audioElement) t._audioElement.volume = Number(t._volume); }
function setSourceRate(t) { if (t._audioElement) t._audioElement.playbackRate = Number(t._speed); }
function seekSource(t, event) {
  const ms = Number(event.target.value) || 0;
  setPlayhead(t, ms, true);
  if (t._audioElement) t._audioElement.currentTime = ms / 1000;
}
function seekPreview(t, event) { pausePreview(t); setPlayhead(t, Number(event.target.value) || 0, true); }
async function toggleSource(t) {
  if (!t._audioUrl) return retryAudio(t);
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
function sanitizeGeneratedTrack(t, normalize = (text) => text) {
  const clean = (text) => removeKnownSttWatermarks(normalize(text));
  t.title = clean(t.title);
  for (const vocal of t._vocals) {
    vocal.head = vocal.head.map(clean);
    for (const row of vocal.rows) {
      row.text = clean(row.text);
      row.words = removeKnownSttWatermarkTokens(row.words).map((word) => ({ ...word, text: clean(word.text) }));
    }
    vocal.rows = fillInstrumentalFallback(vocal.rows.filter((row) => String(row.text || '').trim()));
    vocal.text = linesToText(vocal.rows.map((row) => row.text));
    if (vocal.rows.length && !vocal.untimed) vocal.timingLocked = true;
  }
  const selected = selectedVocal(t);
  t.head = selected.head;
  t.rows = selected.rows;
  t.text = selected.text;
  t.timingLocked = selected.timingLocked;
  t._view = selected._view;
}
function simplifyTrack(t) {
  if (t.authoritativeLrc) return;
  sanitizeGeneratedTrack(t, toSimplified);
  // 保持已有 LRC/KLRC 的时间戳，只把文本改成简体；Phase B 不会重跑 STT。
  if (t.rows.length) lockTiming(t);
  else t._textDirty = true;
  commitHistory(t);
}
const formatMs = (ms) => msToTimestamp(ms);

const curTrack = (t) => ({
  order: t.order, title: t.title, inst: t.inst, lines: t.timingLocked ? t.rows.map((r) => r.text).filter(Boolean) : textToLines(t.text),
});
// 本次会话改过，或此前保存已标记过
const isDirty = (t) => !!(t._orig && t._orig.edited) || isTrackEdited(t._orig, curTrack(t));

function trackState(t) {
  if (!t.rows.length) return t.inst ? '伴奏轨，未生成时间轴' : '尚未对齐，确认后生成时间轴';
  return t.audio ? `已对齐 · ${t.audio}` : '已对齐';
}
const dirtyCount = computed(() => edits.value.reduce(
  (n, e) => n + e.tracks.filter(isDirty).length, 0,
));

// 列出所有 pending 投稿（免记 ref）
async function loadPending() {
  try {
    const resp = await fetch('/api/ingest/list', { headers: authHeaders() });
    if (!resp.ok) return;
    const data = await resp.json().catch(() => ({}));
    pending.value = Array.isArray(data.pending) ? data.pending : [];
  } catch { /* noop */ }
}
function pick(p) {
  if (!canOpenPending(p)) return;
  refInput.value = p.ref;
  load();
}

async function retryPending(p) {
  if (!isFailedPending(p) || isRetryingPending(p)) return;
  const key = pendingRetryKey(p);
  pendingRetryState.value = { ...pendingRetryState.value, [key]: { busy: true, message: '', error: false } };
  try {
    const resp = await fetch('/api/ingest/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ref: p.ref }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      pendingRetryState.value = { ...pendingRetryState.value, [key]: {
        busy: false,
        message: `重试失败：${data.message || data.error || `HTTP ${resp.status}`}`,
        error: true,
      } };
      return;
    }
    pendingRetryState.value = { ...pendingRetryState.value, [key]: { busy: false, message: '已重新排队，正在刷新状态…', error: false } };
    await loadPending();
    if (curRef.value === p.ref) await load(true);
  } catch {
    pendingRetryState.value = { ...pendingRetryState.value, [key]: { busy: false, message: '重试失败：网络错误', error: true } };
  }
}

// list 字段数组 <-> 字符串；tracks lines 数组 <-> textarea 文本
function toEdit(album, draft) {
  const meta = {};
  for (const f of META_FIELDS) {
    const v = draft.meta ? draft.meta[f.key] : undefined;
    meta[f.key] = f.list ? (Array.isArray(v) ? v.join('、') : '') : (v || '');
  }
  return {
    album: draft.album || album,
    _storageAlbum: album,
    _originalAlbum: draft.album || album,
    _draft: draft,
    meta,
    _selectedTrack: 0,
    tracks: (draft.tracks || []).map((t) => {
      const makeVocal = (part) => {
        const parsedRows = part.rows;
        const editorRows = parsedRows.map((r, index) => {
        const words = r.words.map((word) => ({ ...word, _id: newId() }));
        return { ...r, _id: newId(), words: part.timingLocked ? words : expandTimedTokens(words, newId, 100, Number(parsedRows[index + 1]?.time)) };
      });
        return { ...part, _id: newId(), rows: editorRows, _view: editorRows.length ? 'lrc' : 'text' };
      };
      const vocals = parseVocalDrafts(t).map(makeVocal);
      const primary = vocals[0];
      const track = {
        _id: newId(), order: t.order, title: t.title || '', inst: !!t.inst, authoritativeLrc: !!t.authoritative_lrc, outputName: t.output_name || '', finalName: t.final_name || '', confidence: t.confidence,
        coverage: t.coverage, audio: t.audio || '', klrc: t.klrc || '',
        head: primary.head, rows: primary.rows, timingLocked: primary.timingLocked, _view: primary._view, _playing: false, _speed: 1, _previewMs: 0, _textDirty: false,
        _audioUrl: '', _audioElement: null, _audioLoading: false, _audioAbort: null, _audioLoadId: 0, _audioProgress: -1, _audioErr: '', _audioDuration: 0, _sourcePlaying: false, _sourceTimer: null, _previewTimer: null, _volume: 1,
        text: primary.text, _orig: t, _vocals: vocals, _selectedVocal: 0,
      };
      if (!track.authoritativeLrc) sanitizeGeneratedTrack(track);
      track._history = createLyricHistory(track);
      for (const vocal of vocals) { vocal._owner = track; vocal._history = track._history; vocal.name = vocal.id === 'main' ? '主唱' : '和声'; }
      return track;
    }),
    pages: draft.pages || [],
    coverExt: draft.cover_ext || '',
    coverRemoved: false,
    _coverNew: null, _coverPreview: '', _coverBusy: false,
    _saving: false, _msg: '', _err: false,
  };
}

function toDraft(e) {
  const meta = { ...(e._draft.meta || {}) };
  for (const f of META_FIELDS) {
    if (f.list) {
      meta[f.key] = e.meta[f.key].split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean);
    } else {
      meta[f.key] = e.meta[f.key].trim();
    }
  }
  // 展开 _orig 以原样透传 lrc/klrc/coverage/audio/aligned 等对齐产物字段
  const tracks = e.tracks.map((t) => {
    if (t.authoritativeLrc) {
      return {
        ...t._orig,
        order: Number(t.order) || t._orig.order,
        title: t.title.trim(),
        inst: !!t.inst,
        output_name: t.outputName.trim(),
        final_name: t.finalName.trim(),
        edited: false,
      };
    }
    persistVocal(t);
    const timing = serializeVocalDrafts(t._vocals);
    return {
    ...t._orig,
    order: Number(t.order) || t._orig.order,
    title: t.title.trim(),
    inst: !!t.inst,
    output_name: t.outputName.trim(),
    final_name: t.inst ? t.finalName.trim() : '',
    lines: timing.main.timing_locked ? timing.main.lines : textToLines(t._vocals[0].text),
    ...(timing.main.timing_locked ? { lrc: timing.main.lrc, klrc: timing.main.klrc, timing_locked: true } : {}),
    vocals: timing.vocals,
    edited: timing.main.timing_locked ? false : isDirty(t),
  }; });
  const album = cleanAlbumName(e.album, e._originalAlbum);
  const names = { ...(e._draft.names || {}) };
  names.zh_name = /[\u3400-\u9fff]/.test(album) ? album : '';
  names.en_name = /[\u3400-\u9fff]/.test(album) ? '' : album;
  return { ...e._draft, album, names, meta, tracks, cover_ext: e.coverRemoved ? '' : e.coverExt };
}

function cleanAlbumName(value, fallback) {
  const basename = String(value || '').replace(/\\/g, '/').split('/').pop().trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return basename && !/^\.+$/.test(basename) ? basename : fallback;
}

function syncPendingDisplay(e) {
  const display = cleanAlbumName(e.album, e._originalAlbum);
  const item = pending.value.find((p) => p.ref === curRef.value && p.storage_album === e._storageAlbum);
  if (item) item.album = display;
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => { if (!loading.value) load(true); }, 12000);
}

async function load(silent = false) {
  const r = refInput.value.trim();
  if (!r) return;
  loading.value = true;
  if (!silent) { msg.value = ''; msgErr.value = false; }
  try {
    const resp = await fetch(`/api/ingest/state?ref=${encodeURIComponent(r)}`, { headers: authHeaders() });
    if (resp.status === 401) {
      stopPoll();
      msgErr.value = true; msg.value = '登录已失效，请刷新页面重新验证'; return;
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { msgErr.value = true; msg.value = data.error || '加载失败'; return; }
    curRef.value = r;
    jobInfo.value = data.job || null;
    if (data.status === 'processing') {
      clearTimeDrag();
      releaseAllTracks();
      edits.value = [];
      msgErr.value = false;
      msg.value = jobInfo.value?.message || '处理中，页面每 12 秒自动刷新…';
      startPoll();
    } else if (data.status === 'failed') {
      stopPoll();
      clearTimeDrag();
      releaseAllTracks();
      edits.value = [];
      done.value = false;
      msgErr.value = true;
      msg.value = jobInfo.value?.error || '处理失败';
    } else if (data.status === 'complete') {
      stopPoll();
      clearTimeDrag();
      releaseAllTracks();
      edits.value = [];
      done.value = true;
      msgErr.value = false;
      msg.value = '';
    } else {
      stopPoll();
      done.value = false;
      clearTimeDrag();
      releaseAllTracks();
      edits.value = (data.albums || []).filter((a) => a.draft)
        .map((a) => toEdit(a.storage_album, a.draft));
      await nextTick();
      for (const edit of edits.value) await selectTrack(edit);
      msgErr.value = false;
      msg.value = edits.value.length ? '' : '该编号下暂无可编辑草稿（可能已入库或被清理）';
    }
  } catch { msgErr.value = true; msg.value = '网络错误'; }
  finally { loading.value = false; }
}

async function retryPhaseA() {
  if (!curRef.value) return;
  retrying.value = true;
  msgErr.value = false;
  try {
    const resp = await fetch('/api/ingest/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ref: curRef.value }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      msgErr.value = true;
      msg.value = '重新启动失败：' + (data.message || data.error || resp.status);
      return;
    }
    jobInfo.value = null;
    msg.value = '已重新排队，正在启动处理器…';
    await load(true);
    startPoll();
  } catch {
    msgErr.value = true;
    msg.value = '网络错误';
  } finally {
    retrying.value = false;
  }
}

// 换封面：图片原始字节直接写进 bundle 的 cover<ext>，保存草稿时同步 cover_ext；
// 本地即时预览用 objectURL
async function pickCover(e, ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  e._coverBusy = true; e._msg = ''; e._err = false;
  try {
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
    const q = new URLSearchParams({ ref: curRef.value, album: e._storageAlbum, ext });
    const resp = await fetch(`/api/ingest/cover?${q}`, {
      method: 'POST', headers: authHeaders(), body: file,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) { e._err = true; e._msg = '封面上传失败'; return; }
    e.coverExt = ext;
    e.coverRemoved = false;
    e._coverNew = true;
    if (e._coverPreview) URL.revokeObjectURL(e._coverPreview);
    e._coverPreview = URL.createObjectURL(file);
  } catch { e._err = true; e._msg = '封面上传出错'; }
  finally { e._coverBusy = false; }
}

function removeCover(e) {
  e.coverRemoved = true;
  e._coverNew = false;
  if (e._coverPreview) { URL.revokeObjectURL(e._coverPreview); e._coverPreview = ''; }
}

async function save(e) {
  e._saving = true; e._msg = ''; e._err = false;
  try {
    const draft = toDraft(e);
    e.album = draft.album;
    e._originalAlbum = draft.album;
    syncPendingDisplay(e);
    const resp = await fetch('/api/ingest/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ref: curRef.value, album: e._storageAlbum, draft }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      e._msg = '已保存'; e._coverNew = false;
      await loadPending();
    }
    else { e._err = true; e._msg = '保存失败：' + (data.message || data.error || resp.status); }
  } catch { e._err = true; e._msg = '网络错误'; }
  finally { e._saving = false; }
}

// 丢弃草稿：服务端删除 review bundle（原料早已销毁，删的是派生态，不可恢复），
// 同步剔除本地缓存与当前编辑态。404 视为已不存在，同样按丢弃成功处理。
async function discard(ref, album, displayAlbum = album) {
  if (!window.confirm(`丢弃「${displayAlbum}」的草稿？该投稿将不再入库，且无法恢复。`)) return;
  discarding.value = true;
  clearTimeDrag();
  try {
    const resp = await fetch('/api/ingest/discard', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ref, album }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok && resp.status !== 404) {
      msgErr.value = true;
      msg.value = '丢弃失败：' + (data.message || data.error || resp.status);
      return;
    }
    pending.value = pending.value.filter((p) => !(p.ref === ref && p.storage_album === album));
    for (const edit of edits.value.filter((e) => ref === curRef.value && e._storageAlbum === album)) for (const track of edit.tracks) releaseAudio(track);
    edits.value = edits.value.filter((e) => !(ref === curRef.value && e._storageAlbum === album));
    if (!edits.value.length && ref === curRef.value) {
      stopPoll();
      refInput.value = '';
      curRef.value = '';
    }
    if (!pending.value.some((p) => p.ref === ref)) cachedRefs.value = removeRef(ref);
    msgErr.value = false;
    msg.value = `已丢弃「${displayAlbum}」`;
  } catch { msgErr.value = true; msg.value = '网络错误'; }
  finally { discarding.value = false; }
}

async function continueIngest() {
  if (!window.confirm('确认后开始对齐入库（Phase B）并开出 PR。建议先保存所有修改。继续？')) return;
  continuing.value = true;
  try {
    const resp = await fetch('/api/ingest/continue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ref: curRef.value }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      done.value = true;
      msgErr.value = false;
      msg.value = '已排队，正在启动 Phase B…';
      await load(true);
      startPoll();
    }
    else { msgErr.value = true; msg.value = '触发失败：' + (data.message || data.error || resp.status); }
  } catch { msgErr.value = true; msg.value = '网络错误'; }
  finally { continuing.value = false; }
}

onMounted(() => {
  loadCachedRefs();
  loadPending();
  pendingPollTimer = setInterval(loadPending, 12000);
  window.addEventListener('click', closeTimelineMenu);
  window.addEventListener('keydown', closeTimelineMenuOnEscape);
  window.addEventListener('keydown', handleHistoryShortcut);
  window.addEventListener('keydown', handleWorkbenchKeydown);
});
function closeTimelineMenuOnEscape(event) { if (event.key === 'Escape') closeTimelineMenu(); }
function handleHistoryShortcut(event) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' || !historyTrack) return;
  event.preventDefault();
  if (event.shiftKey) redoTrack(historyTrack);
  else undoTrack(historyTrack);
}
onBeforeUnmount(() => {
  stopPoll();
  if (pendingPollTimer) { clearInterval(pendingPollTimer); pendingPollTimer = null; }
  clearTimeDrag();
  window.removeEventListener('click', closeTimelineMenu);
  window.removeEventListener('keydown', closeTimelineMenuOnEscape);
  window.removeEventListener('keydown', handleHistoryShortcut);
  window.removeEventListener('keydown', handleWorkbenchKeydown);
  activeWorkbenchTrack = null;
  for (const e of edits.value) {
    if (e._coverPreview) URL.revokeObjectURL(e._coverPreview);
    for (const t of e.tracks) releaseAudio(t);
  }
});
</script>

<style scoped>
.eb { margin: 1.5rem 0; --eb-accent: var(--theme-color, #3a7afe); }
.eb-card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 10px;
  padding: 1.1rem 1.3rem;
  margin-bottom: 1rem;
}
.rise { animation: eb-rise .3s ease both; }
@keyframes eb-rise { from { opacity: 0; transform: translateY(8px); } }
.eb-label { display: block; font-size: .85rem; margin: .2rem 0 .5rem; font-weight: 600; }
.eb-flabel { display: block; font-size: .78rem; margin-bottom: .25rem; opacity: .8; }
.eb-dim { opacity: .55; font-weight: 400; }
.eb-dim.small { font-size: .75rem; display: block; margin-top: .5rem; }
.eb-album { margin: 0 0 .3rem; }

.eb-input {
  width: 100%;
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
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
  border-radius: 7px;
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

.eb-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: .6rem; }
.eb-field { display: flex; flex-direction: column; }

.eb-track {
  border: 1px solid var(--border-color, #eee);
  border-radius: 8px;
  padding: .6rem .7rem;
  margin-bottom: .6rem;
}
.eb-track-select { display: flex; align-items: center; gap: .45rem; margin: .45rem 0; font-size: .8rem; }
.eb-track-select .eb-select { flex: 1; min-width: 0; }
.eb-workbench { min-width: 0; }
.eb-editor-panel { min-width: 0; }
.eb-track.dirty { background: color-mix(in srgb, var(--eb-accent) 5%, transparent); }
.eb-track.lowcov { border-color: #a371f7; box-shadow: 0 0 0 2px color-mix(in srgb, #a371f7 22%, transparent); }
.eb-track.lowconf { border-color: #e3a008; box-shadow: 0 0 0 2px color-mix(in srgb, #e3a008 25%, transparent); }
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
.eb-inline-player { display: flex; min-width: 0; align-items: center; margin: 0 0 .65rem; padding: .45rem .55rem; border: 1px solid var(--border-color, #ddd); border-radius: 7px; }
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
.eb-klrc { margin-top: .5rem; font-size: .78rem; }
.eb-klrc summary { cursor: pointer; opacity: .7; }
.eb-klrc pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: .75rem;
  margin: .3rem 0 0;
  padding: .5rem .65rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--eb-accent) 5%, transparent);
}
.eb-inst { font-size: .75rem; white-space: nowrap; display: flex; align-items: center; gap: .25rem; opacity: .8; }
.eb-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font-size: .85rem;
  font-family: inherit;
  line-height: 1.6;
  resize: vertical;
}
.eb-textarea:focus { outline: none; border-color: var(--eb-accent); }
@media (max-width: 720px) { .eb-track { padding: .5rem; } .eb-inline-player { align-items: stretch; } .eb-player-time { min-width: auto; } }

.eb-pages { margin: .6rem 0; font-size: .82rem; }
.eb-pages summary { cursor: pointer; opacity: .75; }
.eb-page { margin: .5rem 0; }
.eb-page pre {
  white-space: pre-wrap;
  word-break: break-word;
  background: color-mix(in srgb, var(--eb-accent) 5%, transparent);
  padding: .5rem .65rem;
  border-radius: 6px;
  font-size: .8rem;
  margin: .3rem 0 0;
}
.eb-cover { display: flex; gap: .6rem; align-items: center; margin: .8rem 0; flex-wrap: wrap; }
.eb-cover-thumb {
  width: 3rem;
  height: 3rem;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border-color, #ddd);
}
.eb-cover label.eb-btn { display: inline-flex; align-items: center; }

.eb-pending { list-style: none; margin: .3rem 0 0; padding: 0; }
.eb-pending li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: .6rem;
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
  margin-bottom: .4rem;
  transition: border-color .15s, background .15s;
}
.eb-pending-open {
  display: flex;
  flex: 1 1 12rem;
  min-width: 0;
  justify-content: space-between;
  align-items: center;
  gap: .6rem;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.eb-pending li:not(.processing):hover {
  border-color: var(--eb-accent);
  background: color-mix(in srgb, var(--eb-accent) 6%, transparent);
}
.eb-pending-open:disabled { cursor: default; opacity: 1; }
.eb-pending li.processing { border-style: dashed; }
.eb-p-album { font-weight: 600; }
.eb-p-right { display: flex; flex: 0 0 auto; flex-shrink: 0; gap: .6rem; align-items: center; position: relative; z-index: 1; }
.eb-p-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: .75rem; opacity: .65; white-space: nowrap; }
.eb-pending .eb-msg.inline { flex: 1 0 100%; overflow-wrap: anywhere; }

@media (max-width: 720px) {
  .eb-pending li { align-items: flex-start; }
  .eb-pending-open { flex-basis: 100%; flex-direction: column; align-items: flex-start; gap: .15rem; }
  .eb-p-meta { max-width: 100%; }
  .eb-p-right { width: 100%; justify-content: flex-end; }
}

.eb-msg { font-size: .85rem; margin: .6rem 0 0; color: var(--eb-accent); }
.eb-msg.inline { margin: 0; }
.eb-msg.err { color: #f85149; }
.eb-card.done { border-color: var(--eb-accent); }
.eb-card.done h3 { margin: 0 0 .4rem; color: var(--eb-accent); }
.eb-progress-card { border-color: color-mix(in srgb, var(--eb-accent) 55%, var(--border-color, #ddd)); }
.eb-progress-card h3 { margin: 0; font-size: 1rem; }
.eb-progress-card.failed { border-color: #f85149; }
.eb-progress-card.failed h3 { color: #f85149; }
.eb-progress-head { display: flex; justify-content: space-between; gap: .8rem; align-items: baseline; }
.eb-progress-track { height: .48rem; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--eb-accent) 16%, transparent); margin: .75rem 0 .35rem; }
.eb-progress-fill { display: block; height: 100%; border-radius: inherit; background: var(--eb-accent); transition: width .45s ease; }
.eb-progress-track.unknown .eb-progress-fill { width: 38%; animation: eb-progress 1.1s ease-in-out infinite alternate; }
@keyframes eb-progress { from { transform: translateX(-45%); } to { transform: translateX(220%); } }
</style>
