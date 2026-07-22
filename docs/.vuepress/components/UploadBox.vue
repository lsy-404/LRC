<template>
  <div class="upload-box">
    <!-- 第一步：密码验证 -->
    <section class="ub-card">
      <h3>1 · 验证邀请密码</h3>
      <input
        v-model="pwInput"
        type="password"
        class="ub-input"
        placeholder="邀请密码"
        autocomplete="off"
        :disabled="verified"
        @keyup.enter="verify"
      >
      <div class="ub-row">
        <button class="ub-btn primary" :disabled="verified || verifying" @click="verify">
          {{ verified ? '已验证' : '验证' }}
        </button>
        <span v-if="gateMsg" :class="gateErr ? 'ub-err' : 'ub-ok'">{{ gateMsg }}</span>
      </div>
    </section>

    <!-- 第二步：专辑与文件 -->
    <section v-if="verified && !finished" class="ub-card">
      <h3>2 · 专辑与文件</h3>
      <label class="ub-label">专辑名称（作为投递文件夹名，也是最终专辑名）</label>
      <input v-model="album" type="text" class="ub-input" placeholder="例：再次呼唤我的名字吧" :disabled="busy">
      <div class="ub-row">
        <button class="ub-btn" :disabled="busy" @click="fileInput.click()">添加文件</button>
        <button class="ub-btn" :disabled="busy" @click="dirInput.click()">添加文件夹</button>
        <button class="ub-btn" :disabled="busy || !items.length" @click="items = []">清空</button>
        <input ref="fileInput" type="file" multiple class="ub-hidden" @change="onPickFiles">
        <input ref="dirInput" type="file" webkitdirectory class="ub-hidden" @change="onPickDir">
      </div>
      <ul v-if="items.length" class="ub-list">
        <li v-for="it in items" :key="it.relPath">
          <span class="ub-fname">{{ it.relPath }}</span>
          <span class="ub-fsize">{{ fmtSize(it.size) }}</span>
          <span class="ub-fstat" :class="statClass(it)">{{ statText(it) }}</span>
        </li>
      </ul>
      <p class="ub-hint">{{ totalText }}</p>
      <p class="ub-hint">
        支持歌词文本 / 歌词本图片或 PDF / 音频 / Staff 表 / 封面；单文件上限 95MB。上传期间请勿关闭本页。
      </p>
    </section>

    <!-- 第三步：提交 -->
    <section v-if="verified && !finished" class="ub-card">
      <h3>3 · 提交</h3>
      <div class="ub-bar"><div :style="{ width: barPct + '%' }" /></div>
      <div class="ub-row">
        <button class="ub-btn primary" :disabled="!canSubmit" @click="run">提交</button>
        <button v-if="showRetry" class="ub-btn" :disabled="busy" @click="run">重试失败文件</button>
        <span v-if="submitMsg" :class="submitErr ? 'ub-err' : ''">{{ submitMsg }}</span>
      </div>
    </section>

    <!-- 完成 -->
    <section v-if="finished" class="ub-card">
      <h3>✓ 投稿完成</h3>
      <p>{{ doneDetail }}</p>
      <p class="ub-hint">
        自动化会在几分钟内处理原料并开出 PR，审核通过后自动入库；原料仅在处理期间短暂存在，随后即销毁。
      </p>
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
const barPct = ref(0);
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

const oversize = computed(() => items.value.filter((i) => i.size > MAX_FILE).length);
const totalText = computed(() => {
  if (!items.value.length) return '尚未选择文件';
  const total = items.value.reduce((s, i) => s + i.size, 0);
  return `共 ${items.value.length} 个文件，${fmtSize(total)}`
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
  gateMsg.value = '验证中…';
  try {
    const r = await fetch('/api/upload/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pwInput.value }),
    });
    if (!r.ok) { gateErr.value = true; gateMsg.value = '密码错误'; return; }
    password = pwInput.value;
    verified.value = true;
    gateMsg.value = '验证通过';
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
    // 文件夹名预填专辑名
    album.value = list[0].webkitRelativePath.split('/')[0];
  }
  addFiles(list.map((f) => ({
    file: f,
    relPath: f.webkitRelativePath.split('/').slice(1).join('/') || f.name,
  })));
  e.target.value = '';
}

const readBase64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result.slice(fr.result.indexOf(',') + 1));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(file);
});

const uploadBlob = (it, onProgress) => new Promise((resolve) => {
  readBase64(it.file).then((b64) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/blob');
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.setRequestHeader('authorization', 'Bearer ' + encodeURIComponent(password));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
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

  const totalBytes = items.value.reduce((s, i) => s + i.size, 0);
  let doneBytes = items.value.filter((i) => i.status === 'done').reduce((s, i) => s + i.size, 0);

  for (const it of items.value) {
    if (it.status === 'done') continue;
    it.status = 'up';
    it.pct = 0;
    const sha = await uploadBlob(it, (r) => {
      it.pct = Math.round(r * 100);
      barPct.value = (doneBytes + it.size * r) / totalBytes * 100;
    });
    if (sha) { it.status = 'done'; it.sha = sha; doneBytes += it.size; }
    else it.status = 'fail';
  }
  barPct.value = doneBytes / totalBytes * 100;

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
      `「${name}」共 ${items.value.length} 个文件已作为单次提交推入 upload 投递箱（${String(data.commit).slice(0, 7)}）。`;
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
.upload-box { margin: 1.5rem 0; }
.ub-card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  background: var(--bg-color, transparent);
}
.ub-card h3 { margin: 0 0 .75rem; font-size: 1rem; }
.ub-label { display: block; font-size: .8rem; opacity: .7; margin-bottom: .3rem; }
.ub-input {
  width: 100%;
  padding: .45rem .6rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: .9rem;
  box-sizing: border-box;
}
.ub-input:focus { outline: 2px solid var(--theme-color, #3a7afe); outline-offset: -1px; }
.ub-row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-top: .6rem; }
.ub-btn {
  padding: .4rem 1rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: inherit;
  font-size: .85rem;
}
.ub-btn.primary {
  background: var(--theme-color, #3a7afe);
  border-color: var(--theme-color, #3a7afe);
  color: #fff;
}
.ub-btn:disabled { opacity: .45; cursor: not-allowed; }
.ub-hidden { display: none; }
.ub-list {
  list-style: none;
  margin: .75rem 0 0;
  padding: 0;
  font-size: .8rem;
  max-height: 300px;
  overflow-y: auto;
}
.ub-list li {
  display: flex;
  gap: .5rem;
  align-items: center;
  padding: .3rem .1rem;
  border-bottom: 1px solid var(--border-color, #eee);
}
.ub-list li:last-child { border-bottom: none; }
.ub-fname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ub-fsize { opacity: .6; flex-shrink: 0; }
.ub-fstat { flex-shrink: 0; width: 3.5em; text-align: right; }
.ub-fstat.done { color: #3fb950; }
.ub-fstat.fail { color: #f85149; }
.ub-bar {
  height: 8px;
  background: var(--border-color, #eee);
  border-radius: 4px;
  overflow: hidden;
  margin: .25rem 0 .5rem;
}
.ub-bar > div {
  height: 100%;
  background: var(--theme-color, #3a7afe);
  transition: width .2s;
}
.ub-hint { font-size: .75rem; opacity: .65; margin: .5rem 0 0; }
.ub-ok { color: #3fb950; font-size: .85rem; }
.ub-err { color: #f85149; font-size: .85rem; }
</style>
