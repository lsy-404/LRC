<template>
  <section class="uw" :data-theme="theme">
    <header class="uw-bar">
      <strong>歌词工作区</strong>
      <span class="uw-dim">{{ status }}</span>
      <span class="uw-spacer" />
      <button class="uw-btn" type="button" @click="fileInput.click()">导入文件</button>
      <button class="uw-btn primary" type="button" :disabled="generating || !selectedRemote" @click="generate">
        {{ generating ? '生成中…' : '自动提取并生成' }}
      </button>
      <input ref="fileInput" class="uw-hidden" type="file" multiple @change="importFiles">
    </header>
    <div class="uw-shell">
      <aside class="uw-explorer" aria-label="工作区文件资源管理器">
        <div class="uw-explorer-head"><strong>EXPLORER</strong><button class="uw-new" type="button" title="新建 LRC" aria-label="新建 LRC" @click="newLrc">＋</button></div>
        <button class="uw-root" type="button" :class="{ active: selected?.id === 'welcome' }" @click="select(welcome)">工作草稿</button>
        <div class="uw-tree">
          <button v-for="file in localFiles" :key="file.id" class="uw-file" type="button" :class="{ active: selected?.id === file.id }" @click="select(file)"><span>♫</span>{{ file.name }}</button>
        </div>
        <button class="uw-root" type="button" @click="refresh">现有专辑 <span class="uw-count">{{ albums.length }}</span></button>
        <div v-for="album in albums" :key="album.id" class="uw-album">
          <button class="uw-album-name" type="button" :class="{ active: openAlbum === album.id }" @click="openAlbum = openAlbum === album.id ? '' : album.id">{{ album.name }}</button>
          <div v-if="openAlbum === album.id" class="uw-tree">
            <button class="uw-file" type="button" :class="{ active: selected?.id === album.meta.id }" @click="select(album.meta)"><span>◇</span>meta.json</button>
            <button v-for="file in album.files" :key="file.id" class="uw-file" type="button" :class="{ active: selected?.id === file.id }" @click="select(file)"><span>♫</span>{{ file.name }}</button>
          </div>
        </div>
      </aside>
      <main class="uw-editor">
        <template v-if="selected">
          <div class="uw-tab"><strong>{{ selected.name }}</strong><span>{{ selected.kind === 'meta' ? '整专信息' : selected.remote ? '现有草稿歌词' : '本地工作文件' }}</span></div>
          <MonacoLrcEditor v-model="selected.content" :language="selected.language" :theme="theme" :aria-label="`${selected.name} 编辑器`" />
          <footer class="uw-actions">
            <button class="uw-btn" type="button" :disabled="!selected.remote || saving" @click="save">{{ saving ? '保存中…' : '保存到草稿' }}</button>
            <span class="uw-dim">{{ message }}</span>
          </footer>
        </template>
      </main>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import MonacoLrcEditor from './MonacoLrcEditor.vue';
import { createWorkspaceAdapter } from './workspaceAdapter.js';
import { readRefs } from './refsCache.js';

const props = defineProps({ password: { type: String, default: '' }, theme: { type: String, default: 'light' } });
const fileInput = ref(null); const localFiles = ref([]); const albums = ref([]); const openAlbum = ref('');
const selected = ref(null); const saving = ref(false); const generating = ref(false); const message = ref('');
const welcome = { id: 'welcome', name: 'README.lrc', kind: 'lrc', language: 'lrc', content: '[ti:未命名歌曲]\n[ar:]\n\n', remote: null };
selected.value = welcome;
const selectedRemote = computed(() => selected.value?.remote || null);
const status = computed(() => message.value || '在左侧创建、导入或打开专辑文件');
const adapter = () => createWorkspaceAdapter(props.password);

function select(file) { selected.value = file; message.value = ''; }
function newLrc() {
  const number = localFiles.value.filter((file) => file.kind === 'lrc').length + 1;
  const file = { id: `local-lrc-${Date.now()}`, name: `未命名-${number}.lrc`, kind: 'lrc', language: 'lrc', content: '[ti:未命名歌曲]\n[ar:]\n\n', remote: null };
  localFiles.value.push(file); select(file);
}
async function importFiles(event) {
  const files = Array.from(event.target.files || []); event.target.value = '';
  for (const raw of files) {
    const isLrc = /\.k?lrc$/i.test(raw.name);
    localFiles.value.push({ id: `local-${Date.now()}-${raw.name}-${localFiles.value.length}`, name: raw.name, kind: isLrc ? 'lrc' : 'file', language: isLrc ? 'lrc' : 'plaintext', content: isLrc || /^text\//.test(raw.type) ? await raw.text() : `# 已导入二进制文件\n${raw.name}\n${raw.size} bytes\n`, raw, remote: null });
  }
  if (localFiles.value.length) select(localFiles.value.at(-1));
}
function metaSource(draft) { return JSON.stringify({ album: draft.album || '', meta: draft.meta || {}, names: draft.names || {} }, null, 2) + '\n'; }
function trackSource(track) { return String(track.klrc || track.lrc || (track.lines || []).map((line) => `[00:00.000]${line}`).join('\n')) + '\n'; }
function albumFromState(ref, item) {
  const result = [];
  for (const entry of item.albums || []) {
    if (!entry.draft) continue;
    const draft = entry.draft; const storage = entry.storage_album;
    const album = { id: `${ref}/${storage}`, name: draft.album || entry.album || storage, ref, storage, meta: null, files: [] };
    album.meta = { id: `${album.id}/meta`, name: 'meta.json', kind: 'meta', language: 'json', content: metaSource(draft), remote: { album, draft, type: 'meta' } };
    album.files = (draft.tracks || []).map((track, index) => ({ id: `${album.id}/track/${index}`, name: `${String(track.order || index + 1).padStart(2, '0')} ${track.title || '未命名'}.${track.klrc ? 'klrc' : 'lrc'}`, kind: 'lrc', language: 'lrc', content: trackSource(track), remote: { album, draft, type: 'track', index } }));
    result.push(album);
  }
  return result;
}
async function refresh() {
  message.value = '正在读取现有专辑…'; albums.value = [];
  try {
    const refs = readRefs(); const loaded = await Promise.all(refs.map(async ({ ref }) => albumFromState(ref, await adapter().state(ref))));
    albums.value = loaded.flat(); message.value = albums.value.length ? '' : '暂无可编辑草稿';
  } catch (error) { message.value = `读取失败：${error.message}`; }
}
async function save() {
  const file = selected.value; const remote = file?.remote; if (!remote) return;
  saving.value = true; message.value = '';
  try {
    const draft = structuredClone(remote.draft);
    if (remote.type === 'meta') Object.assign(draft, JSON.parse(file.content));
    else { const track = draft.tracks?.[remote.index]; if (track) { track.lrc = file.content; track.klrc = ''; track.lines = file.content.split('\n').filter(Boolean).map((line) => line.replace(/^\[[^\]]+\]/, '')); track.edited = true; } }
    await adapter().save(remote.album.ref, remote.album.storage, draft);
    remote.draft = draft; message.value = '已保存到草稿';
  } catch (error) { message.value = `保存失败：${error.message}`; } finally { saving.value = false; }
}
async function generate() {
  const remote = selectedRemote.value; if (!remote) return;
  generating.value = true; message.value = '';
  try { await adapter().generate(remote.album.ref); message.value = '已开始自动提取并生成'; } catch (error) { message.value = `生成失败：${error.message}`; } finally { generating.value = false; }
}
onMounted(refresh);
</script>

<style scoped>
.uw { margin: 1rem 0; border: 1px solid var(--border-color, #d0d7de); border-radius: 10px; overflow: hidden; color: var(--text-color, #24292f); background: var(--bg-color, #fff); --uw-accent: var(--theme-color, #3a7afe); }
.uw[data-theme='dark'] { color-scheme: dark; --uw-accent: #58a6ff; }
.uw-bar,.uw-tab,.uw-actions { display:flex; align-items:center; gap:.65rem; padding:.55rem .75rem; border-bottom:1px solid var(--border-color, #d0d7de); background:color-mix(in srgb, var(--bg-color, #fff) 94%, var(--uw-accent)); }
.uw-spacer { flex:1; }.uw-shell { display:grid; grid-template-columns:minmax(12rem, 18rem) minmax(0, 1fr); min-height:42rem; }.uw-explorer { border-right:1px solid var(--border-color, #d0d7de); background:color-mix(in srgb, var(--bg-color, #fff) 97%, var(--uw-accent)); overflow:auto; }.uw-explorer-head { display:flex; justify-content:space-between; padding:.7rem .75rem .35rem; font-size:.72rem; letter-spacing:.08em; }.uw-root,.uw-album-name,.uw-file { display:block; width:100%; padding:.35rem .75rem; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; font:inherit; }.uw-root,.uw-album-name { font-weight:600; }.uw-file { padding-left:1.25rem; font-size:.87rem; }.uw-file span { display:inline-block; width:1.4rem; color:var(--uw-accent); }.uw-file.active,.uw-album-name.active { background:color-mix(in srgb, var(--uw-accent) 17%, transparent); color:var(--uw-accent); }.uw-count,.uw-dim,.uw-tab span { color:color-mix(in srgb, currentColor 62%, transparent); font-size:.82rem; }.uw-editor { min-width:0; display:flex; flex-direction:column; }.uw-editor :deep(.monaco-lrc-editor) { flex:1; height:auto; min-height:36rem; border:0; border-radius:0; }.uw-actions { border-top:1px solid var(--border-color, #d0d7de); border-bottom:0; }.uw-btn,.uw-new { border:1px solid var(--border-color, #d0d7de); border-radius:5px; padding:.3rem .55rem; color:inherit; background:var(--bg-color, #fff); cursor:pointer; font:inherit; font-size:.82rem; }.uw-btn.primary { color:#fff; background:var(--uw-accent); border-color:var(--uw-accent); }.uw-btn:disabled { opacity:.5; cursor:not-allowed; }.uw-hidden { display:none; } @media (max-width:640px) { .uw-shell { grid-template-columns:1fr; }.uw-explorer { border-right:0; border-bottom:1px solid var(--border-color, #d0d7de); max-height:14rem; }.uw-bar { flex-wrap:wrap; }.uw-spacer { display:none; } }
</style>
