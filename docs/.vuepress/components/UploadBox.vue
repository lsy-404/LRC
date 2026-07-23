<template>
  <div class="ub">
    <!-- 轨道号步进器 -->
    <ol class="ub-steps">
      <li :class="{ on: !verified, ok: verified }">
        <span class="ub-no">{{ verified ? '✓' : '01' }}</span>验证
      </li>
      <li :class="{ on: verified && !finished, ok: finished }">
        <span class="ub-no">{{ finished ? '✓' : '02' }}</span>选择
      </li>
      <li :class="{ on: busy || showRetry, ok: finished }">
        <span class="ub-no">{{ finished ? '✓' : '03' }}</span>提交
      </li>
    </ol>

    <!-- 01 · 验证 -->
    <section v-if="!verified && !restoring" class="ub-card">
      <p class="ub-lead">凭邀请密码解锁投递箱。</p>
      <div class="ub-row">
        <input
          v-model="pwInput"
          type="password"
          class="ub-input grow"
          placeholder="邀请密码"
          autocomplete="off"
          @keyup.enter="verify()"
        >
        <button class="ub-btn primary" :disabled="verifying || !pwInput" @click="verify()">
          {{ verifying ? '验证中…' : '验证' }}
        </button>
      </div>
      <p v-if="gateMsg" class="ub-msg" :class="{ err: gateErr }">{{ gateMsg }}</p>
    </section>
    <p v-else-if="restoring" class="ub-verified">正在恢复登录状态…</p>
    <p v-else-if="!finished" class="ub-verified">✓ 密码已验证</p>

    <!-- 02 · 选择 -->
    <section v-if="verified && !finished" class="ub-card rise">
      <label class="ub-label" for="ub-album">专辑名称 <span class="ub-dim">（作为投递文件夹名，也是最终专辑名）</span></label>
      <input
        id="ub-album"
        v-model="album"
        type="text"
        class="ub-input"
        placeholder="例：再次呼唤我的名字吧"
        :disabled="busy"
      >

      <div class="ub-aux">
        <div>
          <label class="ub-label">发布 PV <span class="ub-dim">（Bilibili 链接，选填）</span></label>
          <input v-model="linkBili" type="text" class="ub-input" placeholder="https://www.bilibili.com/video/BV…" :disabled="busy">
        </div>
        <div>
          <label class="ub-label">购买 <span class="ub-dim">（dizzylab 链接，选填）</span></label>
          <input v-model="linkDizzy" type="text" class="ub-input" placeholder="https://www.dizzylab.net/d/…" :disabled="busy">
        </div>
      </div>

      <div
        class="ub-drop"
        :class="{ over: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div class="ub-vinyl" aria-hidden="true"><i /></div>
        <p>把整张专辑的文件夹或文件拖到这里</p>
        <div class="ub-row center">
          <button class="ub-btn" :disabled="busy" @click="fileInput.click()">添加文件</button>
          <button class="ub-btn" :disabled="busy" @click="dirInput.click()">添加文件夹</button>
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

      <ul v-if="items.length" class="ub-list">
        <li v-for="it in sortedItems" :key="it.uid">
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
      <p class="ub-total" :class="{ err: oversize > 0 }">{{ totalText }}</p>
      <p class="ub-dim small">
        支持歌词文本 / 歌词本图片或 PDF / 音频 / Staff 表 / 封面；单文件上限 95MB。
        点击文件名可重命名路径；右侧下拉修改用途会自动归类到对应目录；
        列表按文件名开头编号自动排序。点击图片可放大预览并翻转方向。
        歌词拍照可在下方关联到指定曲目。上传期间请勿关闭本页。
      </p>
    </section>

    <!-- 02.5 · 歌词拍照 ↔ 曲目关联 -->
    <section
      v-if="verified && !finished && photoItems.length && songItems.length"
      class="ub-card rise"
    >
      <p class="ub-label">
        歌词拍照关联
        <span class="ub-dim">（把图片拖到对应曲目，或用图片下方的下拉选择；未关联的图片将自动按发音相似度匹配）</span>
      </p>
      <div class="ub-photos">
        <div v-for="p in photoItems" :key="p.uid" class="ub-photo" :class="{ linked: p.linkTo }">
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
            <option v-for="s in songItems" :key="s.uid" :value="s.uid">{{ baseName(s.relPath) }}</option>
          </select>
        </div>
      </div>
      <ol class="ub-tracks">
        <li
          v-for="s in songItems"
          :key="s.uid"
          :class="{ over: dropUid === s.uid }"
          @dragover.prevent="dropUid = s.uid"
          @dragleave="dropUid = null"
          @drop.prevent="onLinkDrop(s)"
        >
          <span class="ub-tname">{{ baseName(s.relPath) }}</span>
          <span v-for="p in linkedPhotos(s)" :key="p.uid" class="ub-chip">
            {{ baseName(p.relPath) }}<b title="解除关联" @click="p.linkTo = 0">×</b>
          </span>
        </li>
      </ol>
    </section>

    <!-- 03 · 提交 -->
    <section v-if="verified && !finished" class="ub-card rise">
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
      <p>{{ doneDetail }}</p>
      <ol class="ub-next">
        <li class="ok">原料已进入投递箱（单次原子提交）</li>
        <li>自动化处理中（OCR / 对齐 / 元信息，约几分钟到几十分钟）</li>
        <li>自动开出 PR 供审核</li>
        <li>审核通过自动入库，原料随即销毁</li>
      </ol>
    </section>

    <!-- 图片放大预览 -->
    <div v-if="previewItem" class="ub-preview" @click="previewItem = null">
      <div class="ub-preview-tools" @click.stop>
        <button :disabled="rotating || busy" @click="rotateItem(previewItem, -90)">⟲ 左转</button>
        <button :disabled="rotating || busy" @click="rotateItem(previewItem, 90)">⟳ 右转</button>
      </div>
      <img :src="thumbOf(previewItem)" :alt="previewItem.relPath">
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const MAX_FILE = 95 * 1024 * 1024;

const pwInput = ref('');
const verified = ref(false);
const verifying = ref(false);
const restoring = ref(false);
const gateMsg = ref('');
const gateErr = ref(false);

const album = ref('');
const items = ref([]);
const busy = ref(false);
const dragOver = ref(false);
const submitMsg = ref('');
const submitErr = ref(false);
const showRetry = ref(false);
const finished = ref(false);
const doneDetail = ref('');
const linkBili = ref('');
const linkDizzy = ref('');

const fileInput = ref(null);
const dirInput = ref(null);
const camInput = ref(null);
const previewItem = ref(null);
const dragUid = ref(null);
const dropUid = ref(null);
let password = '';
let uid = 1;
let camSeq = 1;

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const isImg = (it) => IMG_RE.test(it.relPath);
const baseName = (p) => p.split('/').pop();

// 编号排序：取文件名开头的数字（与 organize.py 的 _order_from_name 同约定）；
// 无编号排最后，稳定排序保留同号/无号项的相对顺序
const trackNumberOf = (relPath) => {
  const m = baseName(relPath).match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
};
const sortedItems = computed(() =>
  [...items.value].sort((a, b) => trackNumberOf(a.relPath) - trackNumberOf(b.relPath)));
const songItems = computed(() => sortedItems.value.filter((i) => i.role === 'song'));
const photoItems = computed(() => sortedItems.value.filter((i) => i.role === 'photo'));

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
  } catch {
    submitErr.value = true;
    submitMsg.value = '图片旋转失败';
  } finally {
    rotating.value = false;
  }
}
function removeItem(it) {
  dropThumb(it.uid);
  for (const p of items.value) if (p.linkTo === it.uid) p.linkTo = 0;
  if (previewItem.value === it) previewItem.value = null;
  items.value = items.value.filter((x) => x !== it);
}
function clearItems() {
  for (const id of [...thumbs.keys()]) dropThumb(id);
  previewItem.value = null;
  items.value = [];
}

const linkedPhotos = (s) => photoItems.value.filter((p) => p.linkTo === s.uid);
function onLinkDrop(s) {
  const p = items.value.find((i) => i.uid === dragUid.value);
  if (p && p.role === 'photo') p.linkTo = s.uid;
  dragUid.value = null;
  dropUid.value = null;
}

const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
  : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

const KIND = [
  [/(^|\/)manifest\.toml$/i, '讯', 'k-book'],
  [/\.(flac|wav|mp3|m4a|ogg|aac|opus)$/i, '音', 'k-audio'],
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
  if (/\.(flac|wav|mp3|m4a|ogg|aac|opus)$/.test(base)) return 'song';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(base)) {
    return /(cover|封面|主视图)/.test(base) ? 'cover' : 'photo';
  }
  if (/\.(pdf|docx?)$/.test(base)) return 'photo';
  if (/\.(txt|lrc|md)$/.test(base)) {
    return /(staff|制作|名单)/.test(base) ? 'staff' : 'text';
  }
  return 'etc';
}

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
}

const dupSet = computed(() => {
  const seen = new Set();
  const dup = new Set();
  for (const i of items.value) (seen.has(i.relPath) ? dup : seen).add(i.relPath);
  return dup;
});
const isDup = (it) => dupSet.value.has(it.relPath);

const oversize = computed(() => items.value.filter((i) => i.size > MAX_FILE).length);
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
    + (oversize.value ? `；${oversize.value} 个超出单文件上限，无法提交` : '')
    + (dupSet.value.size ? '；存在重复路径（红色波浪线），请重命名' : '');
});
const canSubmit = computed(() =>
  !busy.value && items.value.length > 0 && oversize.value === 0 && dupSet.value.size === 0);

const statText = (it) => it.size > MAX_FILE ? '过大'
  : it.status === 'done' ? '✓'
  : it.status === 'fail' ? '失败'
  : it.status === 'up' ? it.pct + '%' : '待传';
const statClass = (it) => it.size > MAX_FILE || it.status === 'fail' ? 'fail'
  : it.status === 'done' ? 'done' : '';

// 记住密码 30 天：仅存本地，静默重试失败（密码已轮换等）就清掉退回正常输入，
// 不会把用户卡住
const AUTH_KEY = 'lrc-upload-auth';
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return '';
    const { password: pw, exp } = JSON.parse(raw);
    if (typeof pw !== 'string' || !pw || !(exp > Date.now())) {
      localStorage.removeItem(AUTH_KEY);
      return '';
    }
    return pw;
  } catch {
    return '';
  }
}
function saveAuth(pw) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ password: pw, exp: Date.now() + AUTH_TTL_MS }));
  } catch { /* 隐私模式等 localStorage 不可写，静默跳过，不影响本次会话 */ }
}
function clearStoredAuth() {
  try { localStorage.removeItem(AUTH_KEY); } catch { /* noop */ }
}

async function verify(candidate, silent = false) {
  const pw = candidate ?? pwInput.value;
  if (verified.value || verifying.value || !pw) return;
  verifying.value = true;
  if (!silent) { gateErr.value = false; gateMsg.value = ''; }
  try {
    const r = await fetch('/api/upload/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!r.ok) {
      clearStoredAuth();
      if (!silent) { gateErr.value = true; gateMsg.value = '密码错误'; }
      return;
    }
    password = pw;
    verified.value = true;
    saveAuth(pw);
  } catch {
    if (!silent) { gateErr.value = true; gateMsg.value = '网络错误，请重试'; }
  } finally {
    verifying.value = false;
  }
}

function addFiles(picked) {
  if (busy.value) return;
  const have = new Set(items.value.map((i) => i.relPath));
  for (const p of picked) {
    if (have.has(p.relPath)) continue;
    have.add(p.relPath);
    items.value.push({
      ...p, size: p.file.size, status: 'wait', pct: 0, sha: null,
      uid: uid++, role: guessRole(p.relPath), editing: false, editVal: '', linkTo: 0,
      origFile: p.file, rotation: 0,
    });
  }
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
  if (list.length && !album.value) {
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
    if (!album.value) album.value = root.name;
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
// [链接] 表 = 歌词拍照→音轨绑定，管道按 basename 归一消费）
function syncManifest(name) {
  const bili = linkBili.value.trim();
  const dizzy = linkDizzy.value.trim();
  const links = [];
  for (const p of items.value) {
    if (p.role !== 'photo' || !p.linkTo) continue;
    const s = items.value.find((i) => i.uid === p.linkTo && i.role === 'song');
    if (s) links.push([p.relPath, baseName(s.relPath)]);
  }
  const prev = items.value.findIndex((i) => i.relPath === 'manifest.toml' && i.auto);
  if (!bili && !dizzy && !links.length) {
    if (prev !== -1) items.value.splice(prev, 1);
    return;
  }
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const wrap = (label, v) => /^https?:\/\//.test(v) ? `[${label}](${v})` : v;
  const lines = [`album = "${esc(name)}"`];
  if (bili) lines.push(`发布 = "${esc(wrap('Bilibili', bili))}"`);
  if (dizzy) lines.push(`购买 = "${esc(wrap('dizzylab', dizzy))}"`);
  if (links.length) {
    lines.push('', '[链接]');
    for (const [img, audio] of links) lines.push(`"${esc(img)}" = "${esc(audio)}"`);
  }
  const file = new File([lines.join('\n') + '\n'], 'manifest.toml', { type: 'application/toml' });
  const entry = {
    file, relPath: 'manifest.toml', size: file.size, status: 'wait', pct: 0,
    sha: null, uid: prev !== -1 ? items.value[prev].uid : uid++,
    role: 'etc', editing: false, editVal: '', linkTo: 0, auto: true,
  };
  if (prev !== -1) items.value.splice(prev, 1, entry);
  else items.value.push(entry);
}

const readBase64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result.slice(fr.result.indexOf(',') + 1));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(file);
});

const uploadBlob = (it) => new Promise((resolve) => {
  readBase64(it.file).then((b64) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/blob');
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.setRequestHeader('authorization', 'Bearer ' + encodeURIComponent(password));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) it.pct = Math.round(e.loaded / e.total * 100);
    };
    xhr.onload = () => {
      try {
        const sha = JSON.parse(xhr.responseText).sha;
        resolve(xhr.status === 200 && sha ? sha : null);
      } catch { resolve(null); }
    };
    xhr.onerror = () => resolve(null);
    xhr.send('{"encoding":"base64","content":"' + b64 + '"}');
  }).catch(() => resolve(null));
});

async function run() {
  const name = album.value.trim();
  submitErr.value = false;
  if (!name) { submitErr.value = true; submitMsg.value = '请填写专辑名称'; return; }
  if (name.includes('/') || name.includes('\\')) {
    submitErr.value = true; submitMsg.value = '专辑名称不能包含斜杠'; return;
  }
  syncManifest(name);
  busy.value = true;
  showRetry.value = false;
  submitMsg.value = '上传中…';

  for (const it of items.value) {
    if (it.status === 'done') continue;
    it.status = 'up';
    it.pct = 0;
    const sha = await uploadBlob(it);
    if (sha) { it.status = 'done'; it.sha = sha; }
    else { it.status = 'fail'; it.pct = 0; }
  }

  const failed = items.value.filter((i) => i.status !== 'done').length;
  if (failed) {
    busy.value = false;
    submitErr.value = true;
    submitMsg.value = `${failed} 个文件上传失败`;
    showRetry.value = true;
    return;
  }

  submitMsg.value = '正在提交到投递箱…';
  try {
    const r = await fetch('/api/upload/finalize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + encodeURIComponent(password),
      },
      body: JSON.stringify({
        album: name,
        files: items.value.map((i) => ({ path: i.relPath, sha: i.sha })),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || data.error || String(r.status));
    doneDetail.value =
      `「${name}」共 ${items.value.length} 个文件已推入 upload 投递箱（${String(data.commit).slice(0, 7)}）。`;
    finished.value = true;
    busy.value = false;
  } catch (err) {
    busy.value = false;
    submitErr.value = true;
    submitMsg.value = '提交失败：' + err.message + '（已传文件保留，可直接重试）';
    showRetry.value = true;
  }
}

const guard = (e) => { if (busy.value) e.preventDefault(); };
onMounted(async () => {
  window.addEventListener('beforeunload', guard);
  const stored = loadStoredAuth();
  if (stored) {
    restoring.value = true;
    await verify(stored, true);
    restoring.value = false;
  }
});
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
.ub-list {
  list-style: none;
  margin: .9rem 0 0;
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
.ub-photos { display: flex; flex-wrap: wrap; gap: .7rem; margin-top: .6rem; }
.ub-photo { width: 108px; display: flex; flex-direction: column; gap: .3rem; }
.ub-photo img {
  width: 108px;
  height: 76px;
  object-fit: cover;
  border-radius: 7px;
  border: 2px solid var(--border-color, #ddd);
  cursor: grab;
  transition: border-color .2s;
}
.ub-photo.linked img { border-color: var(--ub-accent); }
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
}
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
.ub-next {
  text-align: left;
  max-width: 26rem;
  margin: 1.2rem auto 0;
  padding-left: 1.4rem;
  font-size: .85rem;
  opacity: .85;
}
.ub-next li { margin: .35rem 0; }
.ub-next li.ok { color: var(--ub-accent); }

@media (max-width: 480px) {
  .ub-steps li { font-size: .75rem; gap: .3rem; }
  .ub-progress { flex-direction: column; align-items: stretch; gap: .4rem; }
}
</style>
