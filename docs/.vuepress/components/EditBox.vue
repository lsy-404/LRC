<template>
  <div class="eb">
    <!-- 密码 -->
    <section v-if="needPw" class="eb-card">
      <p class="eb-lead">凭邀请密码解锁修改面板。</p>
      <div class="eb-row">
        <input
          v-model="pwInput"
          type="password"
          class="eb-input grow"
          placeholder="邀请密码"
          autocomplete="off"
          @keyup.enter="verify()"
        >
        <button class="eb-btn primary" :disabled="verifying || !pwInput" @click="verify()">
          {{ verifying ? '验证中…' : '验证' }}
        </button>
      </div>
      <p v-if="pwMsg" class="eb-msg err">{{ pwMsg }}</p>
    </section>

    <template v-else>
      <!-- ref 选择 -->
      <section class="eb-card">
        <label class="eb-label">追踪编号（ref） <span class="eb-dim">投稿完成时给出的编号，或从最近投稿选择</span></label>
        <div class="eb-row">
          <select v-if="cachedRefs.length" v-model="refInput" class="eb-input sel">
            <option value="">— 最近投稿 —</option>
            <option v-for="c in cachedRefs" :key="c.ref" :value="c.ref">
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

      <section v-if="done" class="eb-card done">
        <h3>已触发对齐入库</h3>
        <p>Phase B 正在对齐并整理，稍后会开出 PR 供审核。可关闭本页。</p>
      </section>

      <!-- 逐专辑编辑 -->
      <section v-for="e in edits" :key="e.album" class="eb-card rise">
        <h3 class="eb-album">{{ e.album }}</h3>

        <p class="eb-sub">元信息 <span class="eb-dim">列表字段多个用「、」或换行分隔</span></p>
        <div class="eb-meta">
          <div v-for="f in META_FIELDS" :key="f.key" class="eb-field">
            <label class="eb-flabel">{{ f.label }}</label>
            <input v-model="e.meta[f.key]" class="eb-input" :placeholder="f.list ? '多个用、分隔' : ''">
          </div>
        </div>

        <p class="eb-sub">轨单与歌词 <span class="eb-dim">直接编辑每轨草稿歌词即最终歌词，改完对齐即用</span></p>
        <div v-for="(t, i) in e.tracks" :key="i" class="eb-track">
          <div class="eb-track-head">
            <input v-model.number="t.order" type="number" class="eb-input tiny" title="序号">
            <input v-model="t.title" class="eb-input grow" placeholder="曲名">
            <label class="eb-inst"><input v-model="t.inst" type="checkbox"> 伴奏/无人声</label>
          </div>
          <textarea
            v-model="t.text"
            class="eb-textarea"
            rows="6"
            :placeholder="t.inst ? '伴奏轨：留空则借同名正曲时间轴或写占位' : '逐行歌词'"
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
          <span v-if="e._msg" class="eb-msg inline" :class="{ err: e._err }">{{ e._msg }}</span>
        </div>
      </section>

      <section v-if="edits.length && !done" class="eb-card">
        <button class="eb-btn primary big" :disabled="continuing" @click="continueIngest()">
          {{ continuing ? '触发中…' : '确认并继续（对齐入库）' }}
        </button>
        <p class="eb-dim small">
          请先保存各专辑修改再点此。也可不修改直接继续；72 小时无操作会自动继续。
        </p>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const AUTH_KEY = 'lrc-upload-auth';
const REFS_KEY = 'lrc-upload-refs';
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

const password = ref('');
const needPw = ref(true);
const pwInput = ref('');
const verifying = ref(false);
const pwMsg = ref('');

const cachedRefs = ref([]);
const refInput = ref('');
const curRef = ref('');
const loading = ref(false);
const msg = ref('');
const msgErr = ref(false);
const edits = ref([]);
const continuing = ref(false);
const done = ref(false);
let pollTimer = null;

function authHeaders() {
  return { authorization: 'Bearer ' + encodeURIComponent(password.value) };
}

function loadAuth() {
  try {
    const { password: pw, exp } = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
    return (typeof pw === 'string' && pw && exp > Date.now()) ? pw : '';
  } catch { return ''; }
}
function saveAuth(pw) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ password: pw, exp: Date.now() + AUTH_TTL_MS }));
  } catch { /* noop */ }
}
function loadCachedRefs() {
  try { cachedRefs.value = JSON.parse(localStorage.getItem(REFS_KEY) || '[]'); }
  catch { cachedRefs.value = []; }
}

async function verify() {
  if (!pwInput.value) return;
  verifying.value = true;
  pwMsg.value = '';
  try {
    const r = await fetch('/api/upload/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pwInput.value }),
    });
    if (!r.ok) { pwMsg.value = '密码错误'; return; }
    password.value = pwInput.value;
    needPw.value = false;
    saveAuth(pwInput.value);
  } catch { pwMsg.value = '网络错误，请重试'; }
  finally { verifying.value = false; }
}

// list 字段数组 <-> 字符串；tracks lines 数组 <-> textarea 文本
function toEdit(album, draft) {
  const meta = {};
  for (const f of META_FIELDS) {
    const v = draft.meta ? draft.meta[f.key] : undefined;
    meta[f.key] = f.list ? (Array.isArray(v) ? v.join('、') : '') : (v || '');
  }
  return {
    album,
    _draft: draft,
    meta,
    tracks: (draft.tracks || []).map((t) => ({
      order: t.order, title: t.title || '', inst: !!t.inst,
      text: (t.lines || []).join('\n'), _orig: t,
    })),
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
  const tracks = e.tracks.map((t) => ({
    ...t._orig,
    order: Number(t.order) || t._orig.order,
    title: t.title.trim(),
    inst: !!t.inst,
    lines: t.text.split('\n').filter((s) => s.trim() !== ''),
  }));
  return { ...e._draft, meta, tracks, cover_ext: e.coverRemoved ? '' : e.coverExt };
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
      password.value = ''; needPw.value = true; stopPoll();
      msgErr.value = true; msg.value = '登录已失效，请重新验证密码'; return;
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { msgErr.value = true; msg.value = data.error || '加载失败'; return; }
    curRef.value = r;
    done.value = false;
    if (data.status === 'processing') {
      edits.value = [];
      msgErr.value = false;
      msg.value = 'Phase A 处理中，页面每 12 秒自动刷新…';
      startPoll();
    } else {
      stopPoll();
      edits.value = (data.albums || []).filter((a) => a.draft).map((a) => toEdit(a.album, a.draft));
      msgErr.value = false;
      msg.value = edits.value.length ? '' : '该编号下暂无可编辑草稿（可能已入库或被清理）';
    }
  } catch { msgErr.value = true; msg.value = '网络错误'; }
  finally { loading.value = false; }
}

const readBase64 = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result.slice(fr.result.indexOf(',') + 1));
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(file);
});

// 换封面：先经 /api/upload/blob 建 GitHub blob（复用上传通道），保存时把 blob sha
// 交给 /api/ingest/save 写入 <ref>/<album>/cover<ext>；本地即时预览用 objectURL
async function pickCover(e, ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  e._coverBusy = true; e._msg = ''; e._err = false;
  try {
    const b64 = await readBase64(file);
    const resp = await fetch('/api/upload/blob', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ encoding: 'base64', content: b64 }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.sha) { e._err = true; e._msg = '封面上传失败'; return; }
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
    e._coverNew = { sha: data.sha, ext };
    e.coverExt = ext;
    e.coverRemoved = false;
    if (e._coverPreview) URL.revokeObjectURL(e._coverPreview);
    e._coverPreview = URL.createObjectURL(file);
  } catch { e._err = true; e._msg = '封面上传出错'; }
  finally { e._coverBusy = false; }
}

function removeCover(e) {
  e.coverRemoved = true;
  e._coverNew = null;
  if (e._coverPreview) { URL.revokeObjectURL(e._coverPreview); e._coverPreview = ''; }
}

async function save(e) {
  e._saving = true; e._msg = ''; e._err = false;
  try {
    const resp = await fetch('/api/ingest/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        ref: curRef.value, album: e.album, draft: toDraft(e),
        cover: e._coverNew || undefined,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) { e._msg = '已保存'; e._coverNew = null; }
    else { e._err = true; e._msg = '保存失败：' + (data.message || data.error || resp.status); }
  } catch { e._err = true; e._msg = '网络错误'; }
  finally { e._saving = false; }
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
    if (resp.ok) { done.value = true; stopPoll(); msgErr.value = false; msg.value = ''; }
    else { msgErr.value = true; msg.value = '触发失败：' + (data.message || data.error || resp.status); }
  } catch { msgErr.value = true; msg.value = '网络错误'; }
  finally { continuing.value = false; }
}

onMounted(() => {
  loadCachedRefs();
  const stored = loadAuth();
  if (stored) { password.value = stored; needPw.value = false; }
});
onBeforeUnmount(() => {
  stopPoll();
  for (const e of edits.value) if (e._coverPreview) URL.revokeObjectURL(e._coverPreview);
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
.eb-lead { margin: 0 0 .75rem; }
.eb-label, .eb-sub { display: block; font-size: .85rem; margin: .2rem 0 .5rem; font-weight: 600; }
.eb-sub { margin-top: 1.1rem; }
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
.eb-btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }

.eb-meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: .6rem; }
.eb-field { display: flex; flex-direction: column; }

.eb-track {
  border: 1px solid var(--border-color, #eee);
  border-radius: 8px;
  padding: .6rem .7rem;
  margin-bottom: .6rem;
}
.eb-track-head { display: flex; gap: .5rem; align-items: center; margin-bottom: .5rem; }
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

.eb-msg { font-size: .85rem; margin: .6rem 0 0; color: var(--eb-accent); }
.eb-msg.inline { margin: 0; }
.eb-msg.err { color: #f85149; }
.eb-card.done { border-color: var(--eb-accent); }
.eb-card.done h3 { margin: 0 0 .4rem; color: var(--eb-accent); }
</style>
