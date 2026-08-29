<template>
  <div class="ub">
    <!-- 轨道号步进器 -->
    <ol class="ub-steps">
      <li :class="{ on: !finished, ok: finished }">
        <span class="ub-no">{{ finished ? '✓' : '01' }}</span>选择
      </li>
      <li :class="{ on: busy || showRetry, ok: finished }">
        <span class="ub-no">{{ finished ? '✓' : '02' }}</span>提交
      </li>
    </ol>

    <!-- 01 · 选择 -->
    <section v-if="!finished" class="ub-card rise">
      <div class="ub-type" role="group" aria-label="投稿类型">
        <button class="ub-type-btn" :class="{ on: submissionType === 'album' }" :disabled="busy" @click="submissionType = 'album'">专辑</button>
        <button class="ub-type-btn" :class="{ on: submissionType === 'single' }" :disabled="busy" @click="submissionType = 'single'">单曲</button>
      </div>
      <template v-if="submissionType === 'album'">
        <label class="ub-label" for="ub-album">专辑名称</label>
        <input
          id="ub-album"
          v-model="album"
          type="text"
          class="ub-input"
          placeholder="例：专辑名称"
          :disabled="busy"
        >
      </template>
      <p v-else class="ub-single-target">单曲投稿将进入「单曲」目录</p>

      <p v-if="restoreMsg" class="ub-restore">
        {{ restoreMsg }}
        <button class="ub-btn ghost small" @click="forgetDraft">忘掉</button>
      </p>

      <div class="ub-aux">
        <div>
          <label class="ub-label">发布 PV</label>
          <input v-model="linkBili" type="text" class="ub-input" placeholder="https://www.bilibili.com/video/BV…" :disabled="busy">
        </div>
        <div>
          <label class="ub-label">购买</label>
          <input v-model="linkDizzy" type="text" class="ub-input" placeholder="https://www.dizzylab.net/d/…" :disabled="busy">
        </div>
      </div>

      <div>
        <label class="ub-label" for="ub-lyric-makers">打轴署名</label>
        <input
          id="ub-lyric-makers"
          v-model="lyricMakerText"
          type="text"
          class="ub-input"
          placeholder="多个署名用顿号或逗号分隔"
          :disabled="busy"
          @blur="normalizeLyricMakerText"
        >
      </div>

      <div
        class="ub-drop"
        :class="{ over: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="ub-vinyl" aria-hidden="true"><i /></div>
        <div class="ub-row center">
          <button class="ub-btn" :disabled="busy" @click="fileInput.click()">添加文件</button>
          <button v-if="submissionType === 'album'" class="ub-btn" :disabled="busy" @click="dirInput.click()">添加文件夹</button>
          <button class="ub-btn" :disabled="busy" @click="camInput.click()">拍照</button>
          <button v-if="items.length" class="ub-btn ghost" :disabled="busy" @click="clearItems">清空</button>
        </div>
        <input ref="fileInput" type="file" multiple class="ub-hidden" @change="onPickFiles">
        <input ref="dirInput" type="file" webkitdirectory class="ub-hidden" @change="onPickDir">
        <input
          ref="camInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          class="ub-hidden"
          @change="onPickCam"
        >
      </div>

      <div v-if="items.length" class="ub-groups">
        <div v-for="g in groupedItems" :key="g.role" class="ub-group">
          <p class="ub-group-title">{{ g.label }} <span class="ub-dim">（{{ g.items.length }}）</span></p>
          <ul class="ub-list">
            <li v-for="it in g.items" :key="it.uid">
              <div class="ub-line">
                <img
                  v-if="isImg(it)"
                  :src="thumbOf(it)"
                  class="ub-thumbmini"
                  alt=""
                  @click="previewItem = it"
                >
                <span v-else class="ub-badge" :class="kindClass(it)">{{ kindText(it) }}</span>
                <input
                  v-if="it.editing"
                  v-model="it.editVal"
                  class="ub-input edit"
                  autofocus
                  @keyup.enter="commitEdit(it)"
                  @keyup.esc="it.editing = false"
                  @blur="commitEdit(it)"
                >
                <span
                  v-else
                  class="ub-fname"
                  :class="{ dup: isDup(it) }"
                  :title="it.relPath + '（点击重命名）'"
                  @click="startEdit(it)"
                >{{ it.relPath }}</span>
                <select v-model="it.role" class="ub-sel" :disabled="busy" @change="applyRole(it)">
                  <option value="song">原曲</option>
                  <option value="photo">歌词本·拍照</option>
                  <option value="text">歌词本·文本</option>
                  <option value="staff">Staff表</option>
                  <option value="cover">封面</option>
                  <option value="etc">其他</option>
                </select>
                <span class="ub-fsize">{{ fmtSize(it.size) }}</span>
                <span class="ub-fstat" :class="statClass(it)">{{ statText(it) }}</span>
                <button
                  v-if="!busy"
                  class="ub-x"
                  title="移除"
                  @click="removeItem(it)"
                >×</button>
              </div>
              <div v-if="it.status === 'up'" class="ub-mini"><div :style="{ width: it.pct + '%' }" /></div>
            </li>
          </ul>
        </div>
      </div>
      <p class="ub-total" :class="{ err: oversize > 0 }">{{ totalText }}</p>
    </section>

    <!-- 02.5 · 歌词拍照 ↔ 曲目关联 -->
    <section
      v-if="!finished && photoItems.length && songItems.length"
      class="ub-card rise"
    >
      <p class="ub-label">歌词拍照关联</p>
      <div v-if="hasImages" class="ub-row">
        <button class="ub-btn" :disabled="busy || rotating" @click="rotateAll(-90)">全部左转</button>
        <button class="ub-btn" :disabled="busy || rotating" @click="rotateAll(90)">全部右转</button>
      </div>
      <div class="ub-photos">
        <div
          v-for="p in photoItems"
          :key="p.uid"
          class="ub-photo"
          :class="{ linked: p.linkTo, dropover: reorderUid === p.uid }"
          @dragover.prevent="reorderUid = p.uid"
          @dragleave="reorderUid = null"
          @drop.prevent="onPhotoDrop(p)"
        >
          <img
            :src="thumbOf(p)"
            :alt="p.relPath"
            draggable="true"
            @dragstart="dragUid = p.uid"
            @dragend="dragUid = null"
            @click="previewItem = p"
          >
          <span class="ub-pname" :title="p.relPath">{{ baseName(p.relPath) }}</span>
          <select v-model="p.linkTo" class="ub-sel wide" :disabled="busy">
            <option :value="0">未关联</option>
            <option value="SP">SP · 整专元信息</option>
            <option v-for="s in songItems" :key="s.uid" :value="s.uid">{{ baseName(s.relPath) }}</option>
          </select>
        </div>
      </div>
      <ol class="ub-tracks">
        <li
          class="sp"
          :class="{ over: dropUid === 'SP' }"
          @dragover.prevent="dropUid = 'SP'"
          @dragleave="dropUid = null"
          @drop.prevent="assignDragged('SP')"
        >
          <span class="ub-tname">SP · 整专元信息</span>
          <span
            v-for="p in spPhotos"
            :key="p.uid"
            class="ub-chip"
            :class="{ dropover: reorderUid === p.uid }"
            draggable="true"
            title="拖动排序 / 点击预览"
            @dragstart="dragUid = p.uid"
            @dragend="dragUid = null"
            @dragover.prevent.stop="reorderUid = p.uid"
            @dragleave.stop="reorderUid = null"
            @drop.prevent.stop="onPhotoDrop(p)"
            @click="previewItem = p"
          >{{ baseName(p.relPath) }}<b title="解除关联" @click.stop="p.linkTo = 0">×</b></span>
        </li>
        <li
          v-for="s in songItems"
          :key="s.uid"
          :class="{ over: dropUid === s.uid }"
          @dragover.prevent="dropUid = s.uid"
          @dragleave="dropUid = null"
          @drop.prevent="assignDragged(s.uid)"
        >
          <span class="ub-tname">{{ baseName(s.relPath) }}</span>
          <span
            v-for="p in linkedPhotos(s)"
            :key="p.uid"
            class="ub-chip"
            :class="{ dropover: reorderUid === p.uid }"
            draggable="true"
            title="拖动排序 / 点击预览"
            @dragstart="dragUid = p.uid"
            @dragend="dragUid = null"
            @dragover.prevent.stop="reorderUid = p.uid"
            @dragleave.stop="reorderUid = null"
            @drop.prevent.stop="onPhotoDrop(p)"
            @click="previewItem = p"
          >{{ baseName(p.relPath) }}<b title="解除关联" @click.stop="p.linkTo = 0">×</b></span>
        </li>
      </ol>
    </section>

    <!-- 02 · 提交 -->
    <section v-if="!finished" class="ub-card rise">
      <div class="ub-progress">
        <div class="ub-bar" :class="{ live: busy }"><div :style="{ width: overallPct + '%' }" /></div>
        <span class="ub-ptext">{{ progressText }}</span>
      </div>
      <div class="ub-row">
        <button class="ub-btn primary big" :disabled="!canSubmit" @click="run">
          {{ busy ? '处理中…' : '提交投稿' }}
        </button>
        <button v-if="showRetry" class="ub-btn" :disabled="busy" @click="run">重试失败文件</button>
        <span v-if="submitMsg" class="ub-msg inline" :class="{ err: submitErr }">{{ submitMsg }}</span>
      </div>
    </section>

    <!-- 完成 -->
    <section v-if="finished" class="ub-card done rise">
      <div class="ub-stamp">✓</div>
      <h3>投稿完成</h3>
      <div v-if="lastRef" class="ub-ref">
        <span class="ub-ref-label">追踪编号（ref）</span>
        <code class="ub-ref-code" title="点击复制" @click="copyRef">{{ lastRef }}</code>
      </div>
      <div class="ub-row center">
        <button class="ub-btn primary" @click="resetForNext">返回并提交下一个</button>
      </div>
    </section>

    <!-- 图片放大预览 -->
    <div v-if="previewItem" class="ub-preview" @click="previewItem = null" @wheel.prevent="onPreviewWheel">
      <button
        v-if="previewList.length > 1"
        class="ub-preview-nav prev"
        title="上一张"
        @click.stop="previewStep(-1)"
      >‹</button>
      <div class="ub-preview-tools" @click.stop>
        <select
          v-if="previewItem.role === 'photo' && songItems.length"
          v-model="previewItem.linkTo"
          class="ub-sel"
          :disabled="busy"
        >
          <option :value="0">未关联曲目</option>
          <option v-for="s in songItems" :key="s.uid" :value="s.uid">{{ baseName(s.relPath) }}</option>
        </select>
        <button :disabled="rotating || busy" @click="rotateItem(previewItem, -90)">⟲ 左转</button>
        <button :disabled="rotating || busy" @click="rotateItem(previewItem, 90)">⟳ 右转</button>
      </div>
      <img :src="thumbOf(previewItem)" :alt="previewItem.relPath">
      <button
        v-if="previewList.length > 1"
        class="ub-preview-nav next"
        title="下一张"
        @click.stop="previewStep(1)"
      >›</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { addRef } from './refsCache.js';
import {
  normalizeLyricMakers, serializeDraft, writeDraft, clearDraft, readDraft, restoreItem, debounce,
} from './uploadDraft.js';

// 验证在工作站根层（Workbench）统一完成，密码经 prop 传入
const props = defineProps({ password: { type: String, default: '' } });

const DIRECT_UPLOAD_LIMIT = 95 * 1024 * 1024;
const MULTIPART_PART_SIZE = 20 * 1024 * 1024;

const album = ref('');
const submissionType = ref('album');
const items = ref([]);
const busy = ref(false);
const dragOver = ref(false);
const submitMsg = ref('');
const submitErr = ref(false);
const showRetry = ref(false);
const finished = ref(false);
const lastRef = ref('');
const linkBili = ref('');
const linkDizzy = ref('');
const lyricMakerText = ref('');

const fileInput = ref(null);
const dirInput = ref(null);
const camInput = ref(null);
const previewItem = ref(null);
const dragUid = ref(null);
const dropUid = ref(null);
const reorderUid = ref(null);
let uid = 1;
let camSeq = 1;
let restoreDraft = null;  // 上次编辑状态：重选文件时按 relPath 恢复用途/绑定/旋转/排序
const restoreMsg = ref('');

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const isImg = (it) => IMG_RE.test(it.relPath);
const baseName = (p) => p.split('/').pop();

function normalizeLyricMakerText() {
  lyricMakerText.value = normalizeLyricMakers(lyricMakerText.value).join('、');
}

// 编号排序：取文件名开头的数字（与 organize.py 的 _order_from_name 同约定）；
// 无编号排最后，稳定排序保留同号/无号项的相对顺序
const trackNumberOf = (relPath) => {
  const m = baseName(relPath).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
};
const sortedItems = computed(() =>
  [...items.value].sort((a, b) => trackNumberOf(a.relPath) - trackNumberOf(b.relPath)));
const songItems = computed(() => sortedItems.value.filter((i) => i.role === 'song'));
// 关联面板照片：手动 porder 优先（拖拽重排后），否则文件名开头编号
const photoItems = computed(() =>
  items.value.filter((i) => i.role === 'photo').sort((a, b) => {
    const ka = a.porder ?? trackNumberOf(a.relPath);
    const kb = b.porder ?? trackNumberOf(b.relPath);
    return ka - kb || a.uid - b.uid;
  }));
const hasImages = computed(() => items.value.some(isImg));

// 文件列表按类型分区：区序 音频→歌词本图片→歌词→Staff→封面→其他，区内按文件名编号
const ROLE_ORDER = [
  ['song', '音频'], ['photo', '歌词本图片'], ['text', '歌词'],
  ['staff', 'Staff 表'], ['cover', '封面'], ['etc', '其他'],
];
const groupedItems = computed(() => {
  const byRole = {};
  for (const it of items.value) {
    if (!byRole[it.role]) byRole[it.role] = [];
    byRole[it.role].push(it);
  }
  return ROLE_ORDER
    .filter(([role]) => byRole[role] && byRole[role].length)
    .map(([role, label]) => ({
      role,
      label,
      items: [...byRole[role]].sort((a, b) => trackNumberOf(a.relPath) - trackNumberOf(b.relPath)),
    }));
});

// 预览翻页：在当前排序后的图片集合里循环切换，与预览是从列表还是关联面板打开无关
const previewList = computed(() => sortedItems.value.filter(isImg));
function previewStep(delta) {
  const list = previewList.value;
  if (!list.length || !previewItem.value) return;
  const idx = list.findIndex((i) => i.uid === previewItem.value.uid);
  previewItem.value = list[(idx === -1 ? 0 : idx + delta + list.length) % list.length];
}

// 预览器鼠标滚轮切换上下张（120ms 节流，避免一次滚动狂翻）
let wheelLock = false;
function onPreviewWheel(e) {
  if (wheelLock) return;
  wheelLock = true;
  previewStep(e.deltaY > 0 ? 1 : -1);
  setTimeout(() => { wheelLock = false; }, 120);
}

// 缩略图 objectURL 按 uid 缓存（{file, url}，file 变了则重建，如旋转后）；
// 移除条目/清空/卸载时回收
const thumbs = new Map();
function thumbOf(it) {
  const cached = thumbs.get(it.uid);
  if (cached && cached.file === it.file) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(it.file);
  thumbs.set(it.uid, { file: it.file, url });
  return url;
}
function dropThumb(id) {
  const cached = thumbs.get(id);
  if (cached) { URL.revokeObjectURL(cached.url); thumbs.delete(id); }
}

// 翻转：canvas 重新编码，每次都从未旋转的原始文件重算（避免多次旋转累积
// JPEG 重压缩损失）；转回 0° 时直接复用原始字节，零损失。旋转后的文件即
// 为实际上传内容，OCR/摄取管道拿到的就是校正后的方向
const rotating = ref(false);
function rotateImageFile(file, deg) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const swap = deg % 180 !== 0;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      URL.revokeObjectURL(url);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('rotate failed')); return; }
        resolve(new File([blob], file.name, { type }));
      }, type, 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}
async function rotateItem(it, delta) {
  if (!it || !isImg(it) || busy.value || rotating.value) return;
  rotating.value = true;
  try {
    const next = ((it.rotation || 0) + delta + 360) % 360;
    const src = it.origFile || it.file;
    it.file = next === 0 ? src : await rotateImageFile(src, next);
    it.rotation = next;
    it.size = it.file.size;
    // 已传文件被旋转 → 内容变了，重试时需重传覆盖
    if (it.status === 'done') { it.status = 'wait'; it.pct = 0; }
  } catch {
    submitErr.value = true;
    submitMsg.value = '图片旋转失败';
  } finally {
    rotating.value = false;
    scheduleSave();
  }
}

// 批量旋转：整叠图片一键转（实拍歌词本常整叠同方向横拍）。每张按绝对角度从
// origFile 重算（与 rotateItem 同逻辑，多次旋转不累积 JPEG 重压缩损失）；串行
// await 避免并发争 rotating 锁
async function rotateAll(delta) {
  if (busy.value || rotating.value) return;
  const imgs = items.value.filter(isImg);
  if (!imgs.length) return;
  rotating.value = true;
  try {
    for (const it of imgs) {
      const next = ((it.rotation || 0) + delta + 360) % 360;
      const src = it.origFile || it.file;
      it.file = next === 0 ? src : await rotateImageFile(src, next);
      it.rotation = next;
      it.size = it.file.size;
      if (it.status === 'done') { it.status = 'wait'; it.pct = 0; }
    }
  } catch {
    submitErr.value = true;
    submitMsg.value = '批量旋转失败';
  } finally {
    rotating.value = false;
    scheduleSave();
  }
}
function removeItem(it) {
  dropThumb(it.uid);
  for (const p of items.value) if (p.linkTo === it.uid) p.linkTo = 0;
  if (previewItem.value === it) previewItem.value = null;
  items.value = items.value.filter((x) => x !== it);
  scheduleSave();
}
function clearItems() {
  for (const id of [...thumbs.keys()]) dropThumb(id);
  previewItem.value = null;
  items.value = [];
  scheduleSave();
}

const linkedPhotos = (s) => photoItems.value.filter((p) => p.linkTo === s.uid);
const spPhotos = computed(() => photoItems.value.filter((p) => p.linkTo === 'SP'));
// 把被拖照片分配到目标（to = 曲目 uid，或 'SP' 专辑级元信息）
function assignDragged(to) {
  const p = items.value.find((i) => i.uid === dragUid.value);
  if (p && p.role === 'photo') p.linkTo = to;
  dragUid.value = null;
  dropUid.value = null;
  scheduleSave();
}

// 拖照片到另一张照片上 → 重排：把被拖照片插到目标前，给全体照片重设连续 porder
// （手动顺序覆盖文件名自动排序，仅影响关联面板照片）
function onPhotoDrop(target) {
  reorderUid.value = null;
  const drag = items.value.find((i) => i.uid === dragUid.value);
  dragUid.value = null;
  if (!drag || drag.role !== 'photo' || !target || drag.uid === target.uid) return;
  const order = photoItems.value.map((p) => p.uid);
  const from = order.indexOf(drag.uid);
  if (from === -1) return;
  order.splice(from, 1);
  order.splice(order.indexOf(target.uid), 0, drag.uid);
  const byUid = new Map(items.value.map((i) => [i.uid, i]));
  order.forEach((u, i) => { const it = byUid.get(u); if (it) it.porder = i; });
  scheduleSave();
}

const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
  : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

const KIND = [
  [/(^|\/)manifest\.toml$/i, '讯', 'k-book'],
  [/\.(flac|wav|mp3|m4a|ogg|aac|opus|webm|mp4|mpeg|mpga)$/i, '音', 'k-audio'],
  [/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i, '图', 'k-img'],
  [/\.(pdf|docx?)$/i, '册', 'k-book'],
  [/\.(txt|lrc|md|toml)$/i, '词', 'k-text'],
];
const kindOf = (it) => KIND.find(([re]) => re.test(it.relPath)) || [null, '件', 'k-etc'];
const kindText = (it) => kindOf(it)[1];
const kindClass = (it) => kindOf(it)[2];

// 快速识别：按扩展名/文件名猜用途
function guessRole(p) {
  const base = p.split('/').pop().toLowerCase();
  if (/\.(flac|wav|mp3|m4a|ogg|aac|opus|webm|mp4|mpeg|mpga)$/.test(base)) return 'song';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(base)) {
    return /(cover|封面|主视图)/.test(base) ? 'cover' : 'photo';
  }
  // pdf/docx 是歌词文档（管道走文档抽取，整册消费），不是拍照——不进照片关联面板
  if (/\.(pdf|docx?)$/.test(base)) return 'text';
  if (/\.(txt|lrc|md)$/.test(base)) {
    return /(staff|制作|名单)/.test(base) ? 'staff' : 'text';
  }
  return 'etc';
}

// 疑似伴奏/无人声轨：曲名里的 inst/ins/off vocal/伴奏/无人声（分隔符包裹，避免
// 误伤 "Inspire" 这类词内含 ins 的正常曲名）。命中不阻止提交，只在提交前问一次：
// 两个选择都继续上传——确定=按原曲（转写对齐），取消=自动标记为伴奏（管道不转写，
// 复用同名正曲时间轴或写「纯音乐」占位）。选择经 manifest 伴奏/原曲 键传给管道
const INST_RE = /(?:^|[\s._()[\]-])(?:inst(?:rumental)?|ins|off[\s_-]?vocal)(?:[\s._()[\]-]|$)/i;
const isLikelyInst = (relPath) => {
  const stem = baseName(relPath).replace(/\.[^.]+$/, '');
  return INST_RE.test(stem) || /伴奏|无人声/.test(stem);
};

// 改用途 → 重写路径（封面统一改名 cover.<ext>，其余归入约定目录）
const ROLE_DIR = { song: '音频', photo: '歌词本', text: '歌词' };
function applyRole(it) {
  const base = it.relPath.split('/').pop();
  if (it.role === 'cover') {
    const ext = (base.match(/\.[A-Za-z0-9]+$/) || ['.png'])[0];
    it.relPath = 'cover' + ext.toLowerCase();
  } else if (ROLE_DIR[it.role]) {
    it.relPath = ROLE_DIR[it.role] + '/' + base;
  } else if (it.role === 'staff') {
    it.relPath = base;
  }
  scheduleSave();
}

function startEdit(it) {
  if (busy.value) return;
  it.editVal = it.relPath;
  it.editing = true;
}

function commitEdit(it) {
  if (!it.editing) return;
  it.editing = false;
  const v = it.editVal.replaceAll('\\', '/').split('/')
    .map((s) => s.trim()).filter(Boolean).join('/');
  if (v && v !== it.relPath) {
    it.relPath = v;
    it.role = guessRole(v);
  }
  scheduleSave();
}

const dupSet = computed(() => {
  const seen = new Set();
  const dup = new Set();
  for (const i of items.value) (seen.has(i.relPath) ? dup : seen).add(i.relPath);
  return dup;
});
const isDup = (it) => dupSet.value.has(it.relPath);

const totalBytes = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const doneBytes = computed(() => items.value.reduce((s, i) =>
  s + (i.status === 'done' ? i.size : i.status === 'up' ? i.size * i.pct / 100 : 0), 0));
const overallPct = computed(() => totalBytes.value ? doneBytes.value / totalBytes.value * 100 : 0);
const progressText = computed(() => items.value.length
  ? `${fmtSize(doneBytes.value)} / ${fmtSize(totalBytes.value)}（${Math.round(overallPct.value)}%）`
  : '等待文件');
const totalText = computed(() => {
  if (!items.value.length) return '尚未选择文件';
  return `共 ${items.value.length} 个文件，${fmtSize(totalBytes.value)}`
    + (items.value.some((i) => i.size > DIRECT_UPLOAD_LIMIT) ? '；大文件将自动分片上传' : '')
    + (dupSet.value.size ? '；存在重复路径（红色波浪线），请重命名' : '');
});
const canSubmit = computed(() =>
  !busy.value && items.value.length > 0 && dupSet.value.size === 0);

const statText = (it) => it.status === 'done' ? '✓'
  : it.status === 'fail' ? '失败'
  : it.status === 'up' ? it.pct + '%' : '待传';
const statClass = (it) => it.status === 'fail' ? 'fail'
  : it.status === 'done' ? 'done' : '';

// 系统垃圾文件：任一路径段命中即整条跳过（拖文件夹常带进 .DS_Store / AppleDouble ._* 等）
const JUNK_RE = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\.Spotlight-V100|\.Trashes|__MACOSX|\._.*)$/i;
const isJunk = (relPath) => relPath.split('/').some((seg) => JUNK_RE.test(seg));

function addFiles(picked) {
  if (busy.value) return;
  const have = new Set(items.value.map((i) => i.relPath));
  const toRotate = [];
  let restored = 0;
  for (const p of picked) {
    if (isJunk(p.relPath) || have.has(p.relPath)) continue;
    have.add(p.relPath);
    const it = {
      ...p, size: p.file.size, status: 'wait', pct: 0, n: null,
      uid: uid++, role: guessRole(p.relPath), editing: false, editVal: '', linkTo: 0,
      origFile: p.file, rotation: 0, porder: null,
    };
    // 按 relPath 恢复上次的用途/绑定/旋转/排序，省去重做
    const d = restoreDraft && restoreDraft.map.get(p.relPath);
    if (d) {
      const r = restoreItem(it, d);
      if (r.rotated) toRotate.push(it);
      restored++;
    }
    items.value.push(it);
  }
  for (const it of toRotate) reapplyRotation(it);
  if (restored) restoreMsg.value = `已恢复 ${restored} 个文件的用途/绑定/旋转/顺序`;
  scheduleSave();
}

// 重选文件后恢复旋转：从 origFile 按绝对角度重编码（与手动旋转同逻辑，零损失）
async function reapplyRotation(it) {
  if (!it.rotation || !isImg(it)) return;
  try {
    it.file = await rotateImageFile(it.origFile || it.file, it.rotation);
    it.size = it.file.size;
  } catch { /* noop */ }
}

function onPickFiles(e) {
  addFiles([...e.target.files].map((f) => ({ file: f, relPath: f.name })));
  e.target.value = '';
}

// 拍照：相机文件名常重复（image.jpg），改用自增名并直接归入歌词本目录
function onPickCam(e) {
  addFiles([...e.target.files].map((f) => {
    const ext = (f.name.match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0].toLowerCase();
    return { file: f, relPath: `歌词本/拍照-${camSeq++}${ext}` };
  }));
  e.target.value = '';
}

function onPickDir(e) {
  const list = [...e.target.files];
  if (submissionType.value === 'album' && list.length && !album.value) {
    album.value = list[0].webkitRelativePath.split('/')[0];
  }
  addFiles(list.map((f) => ({
    file: f,
    relPath: f.webkitRelativePath.split('/').slice(1).join('/') || f.name,
  })));
  e.target.value = '';
}

// 拖放：递归遍历目录；单个文件夹拖入时取其名预填专辑名并剥掉根段
async function onDrop(e) {
  dragOver.value = false;
  if (busy.value) return;
  const entries = [...e.dataTransfer.items]
    .map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry())
    .filter(Boolean);
  if (!entries.length) return;

  const picked = [];
  const walk = async (entry, base) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      picked.push({ file, relPath: base + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const en of batch) await walk(en, base + entry.name + '/');
      } while (batch.length);
    }
  };

  if (entries.length === 1 && entries[0].isDirectory) {
    const root = entries[0];
    if (submissionType.value === 'album' && !album.value) album.value = root.name;
    const reader = root.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const en of batch) await walk(en, '');
    } while (batch.length);
  } else {
    for (const en of entries) await walk(en, '');
  }
  addFiles(picked);
}

// 辅助信息 → manifest.toml（organize.py 原生消费：album + 发布/购买中文键，
// 值与主项目 meta 相同的 [标签](url) 格式；manifest 在 meta 合并链优先级最高。
// [链接] 表 = 歌词拍照→音轨绑定；伴奏/原曲 = inst 弹窗的选择——均按 basename 消费）
function syncManifest(name) {
  const bili = linkBili.value.trim();
  const dizzy = linkDizzy.value.trim();
  const lyricMakers = normalizeLyricMakers(lyricMakerText.value);
  const links = [];
  const albumPages = [];
  // inst 弹窗的选择固化进 manifest：标记伴奏 → 管道强制按伴奏处理；
  // 确认原曲 → 推翻管道侧同一套文件名启发式的强制 inst
  const instMarked = [];
  const instAsSong = [];
  for (const i of items.value) {
    if (i.role !== 'song' || !i.instConfirmed) continue;
    (i.instMarked ? instMarked : instAsSong).push(baseName(i.relPath));
  }
  for (const p of items.value) {
    if (p.role !== 'photo' || !p.linkTo) continue;
    if (p.linkTo === 'SP') { albumPages.push(baseName(p.relPath)); continue; }
    const s = items.value.find((i) => i.uid === p.linkTo && i.role === 'song');
    if (s) links.push([p.relPath, baseName(s.relPath)]);
  }
  const prev = items.value.findIndex((i) => i.relPath === 'manifest.toml' && i.auto);
  if (submissionType.value === 'album' && !bili && !dizzy && !lyricMakers.length && !links.length && !albumPages.length
      && !instMarked.length && !instAsSong.length) {
    if (prev !== -1) items.value.splice(prev, 1);
    return;
  }
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const wrap = (label, v) => /^https?:\/\//.test(v) ? `[${label}](${v})` : v;
  const lines = [`album = "${esc(name)}"`];
  if (submissionType.value === 'single') lines.push('submission_type = "single"');
  // 中文键必须加引号：TOML 裸键仅限 ASCII，裸中文键会让 tomllib 整文件解析失败
  if (bili) lines.push(`"发布" = "${esc(wrap('Bilibili', bili))}"`);
  if (dizzy) lines.push(`"购买" = "${esc(wrap('dizzylab', dizzy))}"`);
  lines.push(`"歌词制作" = [${lyricMakers.map((maker) => `"${esc(maker)}"`).join(', ')}]`);
  // SP 专辑级元信息照片：管道当 credits 抽 meta，不分配歌词
  if (albumPages.length) {
    lines.push(`album_pages = [${albumPages.map((n) => `"${esc(n)}"`).join(', ')}]`);
  }
  if (instMarked.length) {
    lines.push(`"伴奏" = [${instMarked.map((n) => `"${esc(n)}"`).join(', ')}]`);
  }
  if (instAsSong.length) {
    lines.push(`"原曲" = [${instAsSong.map((n) => `"${esc(n)}"`).join(', ')}]`);
  }
  if (links.length) {
    lines.push('', '["链接"]');
    for (const [img, audio] of links) lines.push(`"${esc(img)}" = "${esc(audio)}"`);
  }
  const file = new File([lines.join('\n') + '\n'], 'manifest.toml', { type: 'application/toml' });
  const entry = {
    file, relPath: 'manifest.toml', size: file.size, status: 'wait', pct: 0,
    n: prev !== -1 ? items.value[prev].n : null, uid: prev !== -1 ? items.value[prev].uid : uid++,
    role: 'etc', editing: false, editVal: '', linkTo: 0, auto: true,
  };
  if (prev !== -1) items.value.splice(prev, 1, entry);
  else items.value.push(entry);
}

// R2 直传会话：一次投稿一个 session（重试沿用，已传对象仍有效），条目号 n 在
// session 内单调分配且一经分配不变——finalize 清单和 R2 key 就靠它对上号
let session = '';
let nextN = 0;
const newSession = () => {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// 小文件原始二进制直传 R2；超过边缘请求上限的文件改走 multipart，原料不经 base64。
const uploadR2 = (it) => new Promise((resolve) => {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/upload/r2?session=${session}&n=${it.n}`);
  xhr.setRequestHeader('content-type', 'application/octet-stream');
  xhr.setRequestHeader('authorization', 'Bearer ' + encodeURIComponent(props.password));
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) it.pct = Math.round(e.loaded / e.total * 100);
  };
  xhr.onload = () => {
    try { resolve(xhr.status === 200 && JSON.parse(xhr.responseText).ok === true); }
    catch { resolve(false); }
  };
  xhr.onerror = () => resolve(false);
  xhr.send(it.file);
});

const uploadHeaders = () => ({
  'authorization': 'Bearer ' + encodeURIComponent(props.password),
});

async function multipartResponse(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  return response.ok && data.ok ? data : null;
}

async function uploadMultipart(it) {
  let state = it.multipart;
  if (!state) {
    const created = await multipartResponse(
      `/api/upload/multipart?action=create&session=${session}&n=${it.n}`,
      { method: 'POST', headers: uploadHeaders() });
    if (!created?.uploadId) return false;
    state = { uploadId: created.uploadId, parts: [] };
    it.multipart = state;
  }

  const uploaded = new Map(state.parts.map((part) => [part.partNumber, part]));
  const partCount = Math.ceil(it.size / MULTIPART_PART_SIZE);
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const start = (partNumber - 1) * MULTIPART_PART_SIZE;
    const end = Math.min(start + MULTIPART_PART_SIZE, it.size);
    if (!uploaded.has(partNumber)) {
      const part = await multipartResponse(
        `/api/upload/multipart?action=part&session=${session}&n=${it.n}`
          + `&uploadId=${encodeURIComponent(state.uploadId)}&partNumber=${partNumber}`,
        {
          method: 'PUT',
          headers: { ...uploadHeaders(), 'content-type': 'application/octet-stream' },
          body: it.file.slice(start, end),
        });
      if (!part || part.partNumber !== partNumber || !part.etag) return false;
      uploaded.set(partNumber, { partNumber, etag: part.etag });
      state.parts = [...uploaded.values()].sort((a, b) => a.partNumber - b.partNumber);
    }
    it.pct = Math.round(end / it.size * 100);
  }

  const completed = await multipartResponse(
    `/api/upload/multipart?action=complete&session=${session}&n=${it.n}`
      + `&uploadId=${encodeURIComponent(state.uploadId)}`,
    {
      method: 'POST',
      headers: { ...uploadHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ parts: state.parts }),
    });
  if (!completed) return false;
  it.multipart = null;
  return true;
}

const uploadFile = (it) => it.size <= DIRECT_UPLOAD_LIMIT ? uploadR2(it) : uploadMultipart(it);

async function run() {
  const name = submissionType.value === 'single' ? '单曲' : album.value.trim();
  submitErr.value = false;
  if (!name) { submitErr.value = true; submitMsg.value = '请填写专辑名称'; return; }
  if (name.includes('/') || name.includes('\\')) {
    submitErr.value = true; submitMsg.value = '专辑名称不能包含斜杠'; return;
  }
  const instSuspects = items.value.filter((i) =>
    i.role === 'song' && !i.instConfirmed && isLikelyInst(i.relPath));
  if (instSuspects.length) {
    const list = instSuspects.map((i) => baseName(i.relPath)).join('、');
    const asSong = window.confirm(
      `以下音频疑似伴奏/无人声轨：\n${list}\n\n`
      + '「确定」= 按原曲上传（转写对齐出完整歌词）；\n'
      + '「取消」= 自动标记为伴奏并继续上传（不转写，复用同名正曲时间轴，无则写「纯音乐」占位）。');
    instSuspects.forEach((i) => { i.instConfirmed = true; i.instMarked = !asSong; });
  }
  syncManifest(name);
  saveDraft();
  busy.value = true;
  showRetry.value = false;
  submitMsg.value = '上传中…';

  if (!session) session = newSession();
  // 双线程并发上传：投稿多为大音频，2 路并发提升吞吐又不过压边缘函数
  const pending = items.value.filter((it) => it.status !== 'done');
  for (const it of pending) if (it.n == null) it.n = nextN++;
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const it = pending[next++];
      it.status = 'up';
      it.pct = 0;
      if (await uploadFile(it)) { it.status = 'done'; }
      else { it.status = 'fail'; it.pct = 0; }
    }
  };
  await Promise.all([worker(), worker()]);

  const failed = items.value.filter((i) => i.status !== 'done').length;
  if (failed) {
    busy.value = false;
    submitErr.value = true;
    submitMsg.value = `${failed} 个文件上传失败`;
    showRetry.value = true;
    return;
  }

  submitMsg.value = '正在提交…';
  try {
    const r = await fetch('/api/upload/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + encodeURIComponent(props.password),
      },
      body: JSON.stringify({
        album: name,
        submission_type: submissionType.value,
        session,
        lyric_maker: normalizeLyricMakers(lyricMakerText.value),
        files: items.value.map((i) => ({ n: i.n, path: i.relPath, size: i.size })),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || data.error || String(r.status));
    lastRef.value = String(data.ref || '');
    if (lastRef.value) cacheRef(name, lastRef.value);
    // 投稿成功后草稿保留 30 天：期内重投同一专辑不必重做旋转与绑定
    writeDraft(serializeDraft(album.value, items.value, Date.now(), lastRef.value, lyricMakerText.value, submissionType.value));
    finished.value = true;
    busy.value = false;
  } catch (err) {
    busy.value = false;
    submitErr.value = true;
    submitMsg.value = '提交失败：' + err.message + '（已传文件保留，可直接重试）';
    showRetry.value = true;
  }
}

// 草稿快照（元数据级）：把每文件的用途/旋转/绑定/排序持久化，编辑过程中随时存，
// 跨刷新不丢。File 本体无法入 localStorage，重选文件时按 relPath 匹配恢复。
function saveDraft() {
  writeDraft(serializeDraft(album.value, items.value, Date.now(), '', lyricMakerText.value, submissionType.value));
}
const scheduleSave = debounce(saveDraft, 400);

// 追踪编号（ref = 上传会话号）缓存：供「修改」面板下拉回查校正
function cacheRef(album, refVal) {
  addRef(album, refVal);
}
async function copyRef() {
  try { await navigator.clipboard.writeText(lastRef.value); } catch { /* noop */ }
}

// 返回并提交下一个：清空本次投稿状态，回到选择步继续投下一张（验证由 Workbench 根层保持）
function resetForNext() {
  clearItems();
  album.value = '';
  submissionType.value = 'album';
  linkBili.value = '';
  linkDizzy.value = '';
  lyricMakerText.value = '';
  submitMsg.value = '';
  submitErr.value = false;
  showRetry.value = false;
  lastRef.value = '';
  finished.value = false;
  busy.value = false;
  session = '';
  nextN = 0;
}

function forgetDraft() {
  clearDraft();
  restoreDraft = null;
  restoreMsg.value = '';
}

const guard = (e) => { if (busy.value) e.preventDefault(); };
onMounted(() => {
  window.addEventListener('beforeunload', guard);
  restoreDraft = readDraft();
  if (restoreDraft) {
    if (!album.value && restoreDraft.album) album.value = restoreDraft.album;
    submissionType.value = restoreDraft.submissionType;
    lyricMakerText.value = restoreDraft.lyricMakers.join('、');
    const target = restoreDraft.submissionType === 'single' ? '单曲' : (restoreDraft.album || '未命名');
    const who = `「${target}」的 ${restoreDraft.map.size} 个文件`;
    restoreMsg.value = restoreDraft.submittedRef
      ? `上次已投稿 ${who}（编号 ${restoreDraft.submittedRef.slice(0, 7)}）。如需重投，重选这些文件即可，旋转与关联都还记着。`
      : `上次编辑了 ${who}，重选这些文件即可接着来，旋转与关联都还记着。`;
  }
});
watch([album, lyricMakerText, submissionType], () => scheduleSave());
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', guard);
  for (const id of [...thumbs.keys()]) dropThumb(id);
});
</script>

<style scoped>
.ub { margin: 1.5rem 0; --ub-accent: var(--theme-color, #3a7afe); }

/* 步进器：曲目表式轨道号 */
.ub-steps {
  display: flex;
  gap: .25rem;
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0;
}
.ub-steps li {
  flex: 1;
  display: flex;
  align-items: center;
  gap: .5rem;
  font-size: .85rem;
  opacity: .45;
  padding: .5rem .25rem;
  border-top: 2px solid var(--border-color, #ddd);
  transition: opacity .25s, border-color .25s;
}
.ub-steps li.on { opacity: 1; border-top-color: var(--ub-accent); }
.ub-steps li.ok { opacity: .8; border-top-color: var(--ub-accent); }
.ub-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: .05em;
  color: var(--ub-accent);
}

.ub-card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 10px;
  padding: 1.1rem 1.3rem;
  margin-bottom: 1rem;
}
.ub-type { display: inline-flex; margin-bottom: .75rem; border: 1px solid var(--border-color, #ddd); border-radius: 7px; overflow: hidden; }
.ub-type-btn { border: 0; background: transparent; color: inherit; cursor: pointer; padding: .35rem .8rem; font: inherit; font-size: .85rem; }
.ub-type-btn + .ub-type-btn { border-left: 1px solid var(--border-color, #ddd); }
.ub-type-btn.on { color: #fff; background: var(--ub-accent); }
.ub-type-btn:disabled { cursor: not-allowed; opacity: .5; }
.ub-single-target { margin: 0 0 .75rem; font-size: .9rem; color: var(--text-color-secondary, #666); }
.rise { animation: ub-rise .35s ease both; }
@keyframes ub-rise { from { opacity: 0; transform: translateY(8px); } }

.ub-lead { margin: 0 0 .75rem; }
.ub-verified {
  color: var(--ub-accent);
  font-size: .85rem;
  margin: 0 0 1rem;
}

.ub-label { display: block; font-size: .85rem; margin-bottom: .35rem; }
.ub-dim { opacity: .55; }
.ub-dim.small { font-size: .75rem; margin: .6rem 0 0; }

.ub-input {
  width: 100%;
  padding: .5rem .65rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font-size: .9rem;
  box-sizing: border-box;
  transition: border-color .2s, box-shadow .2s;
}
.ub-input:focus {
  outline: none;
  border-color: var(--ub-accent);
  box-shadow: 0 0 0 3px rgba(58, 122, 254, .18);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ub-accent) 22%, transparent);
}
.ub-row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-top: .6rem; }
.ub-row.center { justify-content: center; }
.grow { flex: 1; width: auto; }

.ub-btn {
  padding: .45rem 1.1rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 7px;
  cursor: pointer;
  background: transparent;
  color: inherit;
  font-size: .85rem;
  transition: transform .15s, box-shadow .15s, border-color .15s;
}
.ub-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--ub-accent);
}
.ub-btn.primary {
  background: var(--ub-accent);
  border-color: var(--ub-accent);
  color: #fff;
}
.ub-btn.primary:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(58, 122, 254, .35);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--ub-accent) 40%, transparent);
}
.ub-btn.big { padding: .55rem 1.6rem; font-size: .95rem; }
.ub-btn.ghost { border-style: dashed; opacity: .75; }
.ub-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }
.ub-hidden { display: none; }

/* 拖放区 + 黑胶 */
.ub-drop {
  margin-top: 1rem;
  border: 2px dashed var(--border-color, #ccc);
  border-radius: 10px;
  padding: 1.4rem 1rem 1.2rem;
  text-align: center;
  transition: border-color .2s, background .2s;
}
.ub-drop p { margin: .6rem 0 0; font-size: .85rem; opacity: .75; }
.ub-drop.over {
  border-color: var(--ub-accent);
  background: rgba(58, 122, 254, .06);
  background: color-mix(in srgb, var(--ub-accent) 7%, transparent);
}
.ub-vinyl {
  width: 56px;
  height: 56px;
  margin: 0 auto;
  border-radius: 50%;
  background:
    radial-gradient(circle at center,
      var(--ub-accent) 0 17%,
      #1b1b1f 18% 34%, #2d2d33 35% 37%,
      #1b1b1f 38% 55%, #2d2d33 56% 58%,
      #1b1b1f 59% 78%, #2d2d33 79% 81%,
      #1b1b1f 82% 100%);
  animation: ub-spin 4s linear infinite;
  animation-play-state: paused;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
}
.ub-vinyl i {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  position: relative;
  top: 24px;
  left: 24px;
}
.ub-drop.over .ub-vinyl { animation-play-state: running; }
@keyframes ub-spin { to { transform: rotate(360deg); } }

/* 文件列表 */
.ub-groups { margin: .9rem 0 0; }
.ub-group + .ub-group { margin-top: .8rem; }
.ub-group-title {
  font-size: .78rem;
  font-weight: 600;
  opacity: .75;
  margin: 0 0 .2rem;
  padding-bottom: .15rem;
  border-bottom: 1px solid var(--border-color, #eee);
}
.ub-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: .82rem;
  max-height: 320px;
  overflow-y: auto;
}
.ub-list li { border-bottom: 1px solid var(--border-color, #eee); }
.ub-list li:last-child { border-bottom: none; }
.ub-line { display: flex; gap: .55rem; align-items: center; padding: .38rem .1rem; }
.ub-badge {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: .72rem;
  font-weight: 600;
}
.k-audio { color: #3a7afe; background: rgba(58, 122, 254, .13); }
.k-img { color: #2ba44e; background: rgba(43, 164, 78, .13); }
.k-book { color: #8250df; background: rgba(130, 80, 223, .13); }
.k-text { color: #bf6a02; background: rgba(191, 106, 2, .13); }
.k-etc { color: inherit; background: rgba(127, 127, 127, .15); opacity: .8; }
.ub-thumbmini {
  flex-shrink: 0;
  width: 1.9rem;
  height: 1.5rem;
  object-fit: cover;
  border-radius: 5px;
  border: 1px solid var(--border-color, #ddd);
  cursor: zoom-in;
}
.ub-fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.ub-fname.dup { color: #f85149; text-decoration: underline wavy; }
.ub-input.edit { flex: 1; width: auto; padding: .2rem .4rem; font-size: .8rem; }
.ub-sel {
  flex-shrink: 0;
  max-width: 7.5em;
  font-size: .75rem;
  padding: .15rem .25rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 5px;
  background: transparent;
  color: inherit;
}
.ub-aux { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; margin-top: .8rem; }
@media (max-width: 560px) { .ub-aux { grid-template-columns: 1fr; } }

/* 歌词拍照 ↔ 曲目关联 */
.ub-photos {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: .7rem;
  margin-top: .6rem;
}
@media (max-width: 560px) { .ub-photos { grid-template-columns: repeat(3, 1fr); } }
.ub-photo { display: flex; flex-direction: column; gap: .3rem; min-width: 0; }
.ub-photo img {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  border-radius: 7px;
  border: 2px solid var(--border-color, #ddd);
  cursor: grab;
  transition: border-color .2s;
}
.ub-photo.linked img { border-color: var(--ub-accent); }
.ub-photo.dropover img {
  border-color: var(--ub-accent);
  border-style: dashed;
  transform: scale(1.03);
}
.ub-pname { font-size: .68rem; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ub-sel.wide { max-width: none; width: 100%; }
.ub-tracks { list-style: none; margin: .9rem 0 0; padding: 0; font-size: .82rem; }
.ub-tracks li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: .4rem;
  padding: .4rem .5rem;
  border: 1px dashed transparent;
  border-radius: 7px;
  transition: border-color .15s, background .15s;
}
.ub-tracks li.over {
  border-color: var(--ub-accent);
  background: rgba(58, 122, 254, .06);
  background: color-mix(in srgb, var(--ub-accent) 7%, transparent);
}
.ub-tname { font-weight: 600; }
.ub-tracks li.sp { border-style: solid; border-color: var(--border-color, #eee); }
.ub-chip {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  font-size: .7rem;
  padding: .1rem .45rem;
  border-radius: 99px;
  color: var(--ub-accent);
  background: rgba(58, 122, 254, .13);
  background: color-mix(in srgb, var(--ub-accent) 14%, transparent);
  cursor: grab;
}
.ub-chip.dropover { outline: 2px dashed var(--ub-accent); outline-offset: 1px; }
.ub-chip b { cursor: pointer; font-weight: 700; }

/* 图片放大预览 */
.ub-preview {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, .75);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}
.ub-preview img { max-width: 92vw; max-height: 92vh; border-radius: 8px; }
.ub-preview-tools {
  position: absolute;
  top: 1.2rem;
  right: 1.2rem;
  display: flex;
  gap: .5rem;
  cursor: default;
}
.ub-preview-tools button {
  padding: .4rem .9rem;
  border: 1px solid rgba(255, 255, 255, .35);
  border-radius: 7px;
  background: rgba(0, 0, 0, .35);
  color: #fff;
  font-size: .82rem;
  cursor: pointer;
  transition: background .15s;
}
.ub-preview-tools button:hover:not(:disabled) { background: rgba(255, 255, 255, .18); }
.ub-preview-tools button:disabled { opacity: .4; cursor: not-allowed; }
.ub-preview-tools select {
  padding: .4rem .6rem;
  border: 1px solid rgba(255, 255, 255, .35);
  border-radius: 7px;
  background: rgba(0, 0, 0, .35);
  color: #fff;
  font-size: .82rem;
  max-width: 11em;
}
.ub-preview-tools select:disabled { opacity: .4; cursor: not-allowed; }

/* 预览翻页 */
.ub-preview-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 2.6rem;
  height: 2.6rem;
  border: 1px solid rgba(255, 255, 255, .35);
  border-radius: 50%;
  background: rgba(0, 0, 0, .35);
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  transition: background .15s;
}
.ub-preview-nav:hover { background: rgba(255, 255, 255, .18); }
.ub-preview-nav.prev { left: 1rem; }
.ub-preview-nav.next { right: 1rem; }
@media (max-width: 560px) {
  .ub-preview-nav { width: 2.2rem; height: 2.2rem; font-size: 1.3rem; }
  .ub-preview-nav.prev { left: .4rem; }
  .ub-preview-nav.next { right: .4rem; }
}
.ub-fsize { opacity: .55; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.ub-fstat { flex-shrink: 0; min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; }
.ub-fstat.done { color: #3fb950; }
.ub-fstat.fail { color: #f85149; }
.ub-x {
  flex-shrink: 0;
  border: none;
  background: none;
  color: inherit;
  opacity: .35;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 .15rem;
}
.ub-x:hover { opacity: 1; color: #f85149; }
.ub-mini {
  height: 3px;
  background: var(--border-color, #eee);
  border-radius: 2px;
  overflow: hidden;
  margin: 0 .1rem .3rem;
}
.ub-mini > div { height: 100%; background: var(--ub-accent); transition: width .2s; }
.ub-restore {
  display: flex;
  align-items: center;
  gap: .6rem;
  flex-wrap: wrap;
  font-size: .82rem;
  margin: .7rem 0 0;
  padding: .5rem .7rem;
  border: 1px solid var(--ub-accent, #3a7afe);
  border-radius: 7px;
  background: color-mix(in srgb, var(--ub-accent, #3a7afe) 7%, transparent);
}
.ub-btn.small { padding: .2rem .6rem; font-size: .75rem; }
.ub-total { font-size: .8rem; margin: .6rem 0 0; opacity: .8; }
.ub-total.err { color: #f85149; opacity: 1; }

/* 总进度 */
.ub-progress { display: flex; align-items: center; gap: .8rem; }
.ub-bar {
  flex: 1;
  height: 10px;
  background: var(--border-color, #eee);
  border-radius: 5px;
  overflow: hidden;
}
.ub-bar > div {
  height: 100%;
  background: var(--ub-accent);
  border-radius: 5px;
  transition: width .25s;
}
.ub-bar.live > div {
  background-image: linear-gradient(45deg,
    rgba(255, 255, 255, .25) 25%, transparent 25%, transparent 50%,
    rgba(255, 255, 255, .25) 50%, rgba(255, 255, 255, .25) 75%, transparent 75%);
  background-size: 18px 18px;
  animation: ub-stripe .7s linear infinite;
}
@keyframes ub-stripe { to { background-position: 18px 0; } }
.ub-ptext { font-size: .8rem; opacity: .75; font-variant-numeric: tabular-nums; white-space: nowrap; }

.ub-msg { font-size: .85rem; margin: .6rem 0 0; color: var(--ub-accent); }
.ub-msg.inline { margin: 0; }
.ub-msg.err { color: #f85149; }

/* 完成 */
.ub-card.done { text-align: center; padding: 2rem 1.3rem; }
.ub-card.done h3 { margin: .6rem 0 .4rem; }
.ub-stamp {
  width: 56px;
  height: 56px;
  margin: 0 auto;
  border-radius: 50%;
  background: var(--ub-accent);
  color: #fff;
  font-size: 1.8rem;
  line-height: 56px;
  animation: ub-pop .4s cubic-bezier(.2, 1.6, .4, 1) both;
}
@keyframes ub-pop { from { transform: scale(.3); opacity: 0; } }
.ub-ref {
  display: flex;
  flex-direction: column;
  gap: .35rem;
  align-items: center;
  margin: 1rem auto 0;
  max-width: 30rem;
}
.ub-ref-label { font-size: .75rem; opacity: .6; }
.ub-ref-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .82rem;
  word-break: break-all;
  padding: .3rem .6rem;
  border-radius: 6px;
  background: rgba(58, 122, 254, .1);
  background: color-mix(in srgb, var(--ub-accent) 12%, transparent);
  cursor: pointer;
}

@media (max-width: 480px) {
  .ub-steps li { font-size: .75rem; gap: .3rem; }
  .ub-progress { flex-direction: column; align-items: stretch; gap: .4rem; }
}
</style>
