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
    <section v-if="!verified" class="ub-card">
      <p class="ub-lead">凭邀请密码解锁投递箱。</p>
      <div class="ub-row">
        <input
          v-model="pwInput"
          type="password"
          class="ub-input grow"
          placeholder="邀请密码"
          autocomplete="off"
          @keyup.enter="verify"
        >
        <button class="ub-btn primary" :disabled="verifying || !pwInput" @click="verify">
          {{ verifying ? '验证中…' : '验证' }}
        </button>
      </div>
      <p v-if="gateMsg" class="ub-msg" :class="{ err: gateErr }">{{ gateMsg }}</p>
    </section>
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
          <button v-if="items.length" class="ub-btn ghost" :disabled="busy" @click="items = []">清空</button>
        </div>
        <input ref="fileInput" type="file" multiple class="ub-hidden" @change="onPickFiles">
        <input ref="dirInput" type="file" webkitdirectory class="ub-hidden" @change="onPickDir">
      </div>

      <ul v-if="items.length" class="ub-list">
        <li v-for="it in items" :key="it.relPath">
          <div class="ub-line">
            <span class="ub-badge" :class="kindClass(it)">{{ kindText(it) }}</span>
            <span class="ub-fname" :title="it.relPath">{{ it.relPath }}</span>
            <span class="ub-fsize">{{ fmtSize(it.size) }}</span>
            <span class="ub-fstat" :class="statClass(it)">{{ statText(it) }}</span>
            <button
              v-if="!busy"
              class="ub-x"
              title="移除"
              @click="items = items.filter((x) => x !== it)"
            >×</button>
          </div>
          <div v-if="it.status === 'up'" class="ub-mini"><div :style="{ width: it.pct + '%' }" /></div>
        </li>
      </ul>
      <p class="ub-total" :class="{ err: oversize > 0 }">{{ totalText }}</p>
      <p class="ub-dim small">
        支持歌词文本 / 歌词本图片或 PDF / 音频 / Staff 表 / 封面；单文件上限 95MB。上传期间请勿关闭本页。
      </p>
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const MAX_FILE = 95 * 1024 * 1024;

const pwInput = ref('');
const verified = ref(false);
const verifying = ref(false);
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

const fileInput = ref(null);
const dirInput = ref(null);
let password = '';

const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
  : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

const KIND = [
  [/\.(flac|wav|mp3|m4a|ogg|aac|opus)$/i, '音', 'k-audio'],
  [/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i, '图', 'k-img'],
  [/\.(pdf|docx?)$/i, '册', 'k-book'],
  [/\.(txt|lrc|md|toml)$/i, '词', 'k-text'],
];
const kindOf = (it) => KIND.find(([re]) => re.test(it.relPath)) || [null, '件', 'k-etc'];
const kindText = (it) => kindOf(it)[1];
const kindClass = (it) => kindOf(it)[2];

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
    + (oversize.value ? `；${oversize.value} 个超出单文件上限，无法提交` : '');
});
const canSubmit = computed(() => !busy.value && items.value.length > 0 && oversize.value === 0);

const statText = (it) => it.size > MAX_FILE ? '过大'
  : it.status === 'done' ? '✓'
  : it.status === 'fail' ? '失败'
  : it.status === 'up' ? it.pct + '%' : '待传';
const statClass = (it) => it.size > MAX_FILE || it.status === 'fail' ? 'fail'
  : it.status === 'done' ? 'done' : '';

async function verify() {
  if (verified.value || verifying.value) return;
  verifying.value = true;
  gateErr.value = false;
  gateMsg.value = '';
  try {
    const r = await fetch('/api/upload/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pwInput.value }),
    });
    if (!r.ok) { gateErr.value = true; gateMsg.value = '密码错误'; return; }
    password = pwInput.value;
    verified.value = true;
  } catch {
    gateErr.value = true;
    gateMsg.value = '网络错误，请重试';
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
    items.value.push({ ...p, size: p.file.size, status: 'wait', pct: 0, sha: null });
  }
}

function onPickFiles(e) {
  addFiles([...e.target.files].map((f) => ({ file: f, relPath: f.name })));
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
onMounted(() => window.addEventListener('beforeunload', guard));
onBeforeUnmount(() => window.removeEventListener('beforeunload', guard));
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
.ub-fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
