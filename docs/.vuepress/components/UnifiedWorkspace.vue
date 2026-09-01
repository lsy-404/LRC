<template>
  <section class="uw" :data-theme="theme">
    <header class="uw-bar">
      <strong>歌词工作区</strong><span class="uw-dim">{{ status }}</span><span class="uw-spacer" />
      <button class="uw-btn" type="button" @click="createWorkspace">新建专辑</button>
      <button class="uw-btn" type="button" @click="fileInput.click()">导入文件</button>
      <button class="uw-btn primary" type="button" :disabled="generating || !canGenerate" @click="generate">{{ generating ? '上传并生成中…' : '自动提取并生成' }}</button>
      <input ref="fileInput" class="uw-hidden" type="file" multiple @change="importFiles">
    </header>
    <div class="uw-shell">
      <aside class="uw-explorer" aria-label="工作区文件资源管理器">
        <div class="uw-explorer-head"><strong>EXPLORER</strong><button class="uw-new" type="button" title="新建 LRC" aria-label="新建 LRC" @click="newLrc">＋</button></div>
        <button class="uw-root" type="button" @click="refresh">工作草稿 <span class="uw-count">{{ workspaces.length }}</span></button>
        <div v-for="album in workspaces" :key="album.id" class="uw-album">
          <button class="uw-album-name" type="button" :class="{ active: openAlbum === album.id }" @click="toggleWorkspace(album)">{{ album.name }}</button>
          <div v-if="openAlbum === album.id" class="uw-tree">
            <button class="uw-file" type="button" :class="{ active: selected?.id === album.meta.id }" @click="select(album.meta)"><span>◇</span>meta.json</button>
            <button v-for="file in album.files" :key="file.id" class="uw-file" type="button" :class="{ active: selected?.id === file.id }" @click="select(file)"><span>♫</span>{{ file.name }}</button>
          </div>
        </div>
        <button class="uw-root" type="button" @click="refresh">现有专辑 <span class="uw-count">{{ catalog.length }}</span></button>
        <div class="uw-tree">
          <button v-for="album in catalog" :key="album.slug" class="uw-file" type="button" @click="openPublished(album)"><span>□</span>{{ album.name || album.folder }}</button>
        </div>
        <button v-if="localFiles.length" class="uw-root" type="button">待上传文件 <span class="uw-count">{{ localFiles.length }}</span></button>
        <div class="uw-tree"><button v-for="file in localFiles" :key="file.id" class="uw-file" type="button" :class="{ active: selected?.id === file.id }" @click="select(file)"><span>↥</span>{{ file.name }}</button></div>
      </aside>
      <main class="uw-editor">
        <nav class="uw-tabs" role="tablist" aria-label="工作区标签页">
          <button class="uw-tab" :class="{ active: activeTab === 'upload' }" type="button" role="tab" :aria-selected="activeTab === 'upload'" @click="activeTab = 'upload'">上传</button>
          <button class="uw-tab" :class="{ active: activeTab === 'visual' }" type="button" role="tab" :aria-selected="activeTab === 'visual'" @click="activeTab = 'visual'">可视化编辑</button>
          <button v-for="file in fileTabs" :key="file.id" class="uw-tab" :class="{ active: activeTab === file.id }" type="button" role="tab" :aria-selected="activeTab === file.id" @click="activateFile(file)">
            <span>{{ file.name }}</span><span class="uw-tab-close" role="button" tabindex="0" :aria-label="`关闭 ${file.name}`" @click.stop="closeFileTab(file.id)" @keydown.enter.stop="closeFileTab(file.id)" @keydown.space.prevent.stop="closeFileTab(file.id)">×</span>
          </button>
        </nav>
        <section v-show="activeTab === `upload`" class="uw-tab-panel uw-feature-panel"><UploadBox :password="password" :theme="theme" /></section>
        <section v-show="activeTab === `visual`" class="uw-tab-panel uw-feature-panel"><EditBox :password="password" :theme="theme" /></section>
        <section v-if="activeFile" class="uw-tab-panel uw-file-panel">
          <MonacoLrcEditor v-model="activeFile.content" :language="activeFile.language" :theme="theme" :aria-label="`${activeFile.name} 编辑器`" />
          <footer class="uw-actions"><button class="uw-btn" type="button" :disabled="!activeFile.remote || saving" @click="save">{{ saving ? '保存中…' : '保存工作草稿' }}</button><span class="uw-dim">{{ message }}</span></footer>
        </section>
      </main>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import MonacoLrcEditor from './MonacoLrcEditor.vue';
import UploadBox from './UploadBox.vue';
import EditBox from './EditBox.vue';
import { createWorkspaceAdapter } from './workspaceAdapter.js';

const props = defineProps({ password: { type: String, default: '' }, theme: { type: String, default: 'light' } });
const fileInput = ref(null); const localFiles = ref([]); const workspaces = ref([]); const catalog = ref([]); const openAlbum = ref('');
const selected = ref(null); const fileTabs = ref([]); const activeTab = ref('upload'); const saving = ref(false); const generating = ref(false); const message = ref('');
const adapter = () => createWorkspaceAdapter(props.password);
const status = computed(() => message.value || '在左侧创建、导入或打开专辑文件');
const canGenerate = computed(() => localFiles.value.length > 0 || workspaces.value.some((workspace) => workspace.draft.tracks?.length > 0));
const activeFile = computed(() => fileTabs.value.find((file) => file.id === activeTab.value) || null);
const sourceForTrack = (track) => String(track.klrc || track.lrc || (track.lines || []).map((line) => `[00:00.000]${line}`).join('\n')) + '\n';
const metaSource = (draft) => JSON.stringify({ album: draft.album || '', meta: draft.meta || {}, names: draft.names || {} }, null, 2) + '\n';

function select(file) {
  selected.value = file;
  if (!fileTabs.value.some((tab) => tab.id === file.id)) fileTabs.value.push(file);
  activeTab.value = file.id;
  message.value = '';
}
function activateFile(file) { selected.value = file; activeTab.value = file.id; }
function closeFileTab(id) {
  const index = fileTabs.value.findIndex((file) => file.id === id);
  if (index < 0) return;
  const wasActive = activeTab.value === id;
  fileTabs.value.splice(index, 1);
  if (wasActive) activeTab.value = fileTabs.value[index]?.id || fileTabs.value[index - 1]?.id || 'upload';
  selected.value = activeFile.value;
}
function workspaceFromDraft(ref, draft) {
  const album = { id: ref, name: draft.album || '未命名专辑', ref, draft, meta: null, files: [] };
  album.meta = { id: `${ref}/meta`, name: 'meta.json', kind: 'meta', language: 'json', content: metaSource(draft), remote: { album, type: 'meta' } };
  album.files = (draft.tracks || []).map((track, index) => ({ id: `${ref}/track/${index}`, name: `${String(track.order || index + 1).padStart(2, '0')} ${track.title || '未命名'}.lrc`, kind: 'lrc', language: 'lrc', content: sourceForTrack(track), remote: { album, type: 'track', index } }));
  return album;
}
function replaceWorkspace(ref, draft) {
  const next = workspaceFromDraft(ref, draft); const index = workspaces.value.findIndex((item) => item.ref === ref);
  if (index < 0) workspaces.value.unshift(next); else workspaces.value.splice(index, 1, next);
  fileTabs.value = fileTabs.value.map((file) => {
    if (file.remote?.album?.ref !== ref) return file;
    return file.remote.type === 'meta' ? next.meta : next.files[file.remote.index];
  }).filter(Boolean);
  openAlbum.value = ref; return next;
}
async function refresh() {
  message.value = '正在读取工作区…';
  try {
    const [listed, catalogued] = await Promise.all([adapter().list(), adapter().catalog()]);
    catalog.value = catalogued.albums || [];
    const drafts = await Promise.all((listed.workspaces || []).map(async ({ ref }) => adapter().draft(ref)));
    workspaces.value = drafts.map(({ ref, draft }) => workspaceFromDraft(ref, draft)); message.value = '';
  } catch (error) { message.value = `读取失败：${error.message}`; }
}
async function createWorkspace() {
  const album = window.prompt('专辑名称'); if (!album) return;
  try { const created = await adapter().create(album); const workspace = replaceWorkspace(created.ref, created.draft); select(workspace.meta); } catch (error) { message.value = `创建失败：${error.message}`; }
}
async function openPublished(item) {
  try { message.value = '正在复制现有专辑…'; const opened = await adapter().open(item.slug); const workspace = replaceWorkspace(opened.ref, opened.draft); select(workspace.meta); message.value = ''; } catch (error) { message.value = `打开失败：${error.message}`; }
}
function toggleWorkspace(album) { openAlbum.value = openAlbum.value === album.id ? '' : album.id; }
async function newLrc() {
  let workspace = selected.value?.remote?.album || workspaces.value[0];
  if (!workspace) { await createWorkspace(); workspace = selected.value?.remote?.album; }
  if (!workspace) return;
  const title = window.prompt('LRC 文件名', `歌词-${workspace.files.length + 1}.lrc`); if (!title) return;
  try { const result = await adapter().lrc(workspace.ref, title); workspace.draft.tracks.push(result.track); const next = replaceWorkspace(workspace.ref, workspace.draft); select(next.files.at(-1)); } catch (error) { message.value = `新建失败：${error.message}`; }
}
async function importFiles(event) {
  const files = Array.from(event.target.files || []); event.target.value = '';
  for (const raw of files) { const lrc = /\.k?lrc$/i.test(raw.name); localFiles.value.push({ id: `local-${Date.now()}-${raw.name}-${localFiles.value.length}`, name: raw.name, kind: lrc ? 'lrc' : 'file', language: lrc ? 'lrc' : 'plaintext', content: lrc || /^text\//.test(raw.type) ? await raw.text() : `# 已导入二进制文件\n${raw.name}\n${raw.size} bytes\n`, raw, remote: null }); }
  if (localFiles.value.length) select(localFiles.value.at(-1));
}
async function save() {
  const file = activeFile.value; const remote = file?.remote; if (!remote) return; saving.value = true; message.value = '';
  try {
    const draft = JSON.parse(JSON.stringify(remote.album.draft));
    if (remote.type === 'meta') Object.assign(draft, JSON.parse(file.content));
    else { const track = draft.tracks[remote.index]; track.lrc = file.content; track.klrc = ''; track.lines = file.content.split('\n').filter(Boolean).map((line) => line.replace(/^\[[^\]]+\]/, '')); track.edited = true; }
    await adapter().save(remote.album.ref, draft); const workspace = replaceWorkspace(remote.album.ref, draft); select(remote.type === 'meta' ? workspace.meta : workspace.files[remote.index]); message.value = '已保存到工作草稿'; return true;
  } catch (error) { message.value = `保存失败：${error.message}`; return false; } finally { saving.value = false; }
}
async function generate() {
  if (activeFile.value?.remote && !(await save())) return;
  let workspace = activeFile.value?.remote?.album || workspaces.value[0];
  if (!workspace) { await createWorkspace(); workspace = activeFile.value?.remote?.album; }
  if (!workspace) return;
  generating.value = true; message.value = '';
  try {
    const files = [];
    for (const [n, file] of localFiles.value.entries()) {
      if (!file.raw) continue;
      const uploadFile = file.kind === 'lrc' || /^text\//.test(file.raw.type)
        ? new File([file.content], file.name, { type: file.raw.type || 'text/plain' })
        : file.raw;
      await adapter().upload(workspace.ref, n, uploadFile);
      files.push({ n, path: file.name, size: uploadFile.size });
    }
    await adapter().extract(workspace.ref, files); message.value = '已上传并开始自动提取与生成';
  } catch (error) { message.value = `生成失败：${error.message}`; } finally { generating.value = false; }
}
onMounted(refresh);
</script>

<style scoped>
.uw { margin:1rem 0; border:1px solid var(--border-color,#d0d7de); border-radius:10px; overflow:hidden; color:var(--text-color,#24292f); background:var(--bg-color,#fff); --uw-accent:var(--theme-color,#3a7afe); }.uw[data-theme='dark'] { color-scheme:dark; --uw-accent:#58a6ff; }.uw-bar,.uw-actions { display:flex; align-items:center; gap:.65rem; padding:.55rem .75rem; border-bottom:1px solid var(--border-color,#d0d7de); background:color-mix(in srgb,var(--bg-color,#fff) 94%,var(--uw-accent)); }.uw-spacer { flex:1; }.uw-shell { display:grid; grid-template-columns:minmax(12rem,18rem) minmax(0,1fr); height:min(42rem,calc(100vh - 11rem)); min-height:30rem; overflow:hidden; }.uw-explorer { min-height:0; border-right:1px solid var(--border-color,#d0d7de); background:color-mix(in srgb,var(--bg-color,#fff) 97%,var(--uw-accent)); overflow-y:auto; }.uw-explorer-head { display:flex; justify-content:space-between; padding:.7rem .75rem .35rem; font-size:.72rem; letter-spacing:.08em; }.uw-root,.uw-album-name,.uw-file { display:block; width:100%; padding:.35rem .75rem; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; font:inherit; }.uw-root,.uw-album-name { font-weight:600; }.uw-file { padding-left:1.25rem; font-size:.87rem; }.uw-file span { display:inline-block; width:1.4rem; color:var(--uw-accent); }.uw-file.active,.uw-album-name.active { background:color-mix(in srgb,var(--uw-accent) 17%,transparent); color:var(--uw-accent); }.uw-count,.uw-dim { color:color-mix(in srgb,currentColor 62%,transparent); font-size:.82rem; }.uw-editor { min-width:0; min-height:0; display:flex; flex-direction:column; overflow:hidden; }.uw-tabs { display:flex; flex:none; overflow-x:auto; border-bottom:1px solid var(--border-color,#d0d7de); background:color-mix(in srgb,var(--bg-color,#fff) 94%,var(--uw-accent)); }.uw-tab { display:flex; flex:none; align-items:center; gap:.45rem; min-width:0; border:0; border-right:1px solid var(--border-color,#d0d7de); padding:.55rem .75rem; color:inherit; background:transparent; cursor:pointer; font:inherit; white-space:nowrap; }.uw-tab.active { background:var(--bg-color,#fff); color:var(--uw-accent); box-shadow:inset 0 2px var(--uw-accent); }.uw-tab-close { display:grid; place-items:center; width:1.1rem; height:1.1rem; border-radius:3px; color:inherit; }.uw-tab-close:hover,.uw-tab-close:focus { background:color-mix(in srgb,currentColor 15%,transparent); }.uw-tab-panel { min-height:0; overflow-y:auto; }.uw-feature-panel { flex:1; padding:0 1rem; }.uw-file-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }.uw-file-panel :deep(.monaco-lrc-editor) { flex:1; min-height:0; height:auto; border:0; border-radius:0; }.uw-actions { flex:none; border-top:1px solid var(--border-color,#d0d7de); border-bottom:0; }.uw-btn,.uw-new { border:1px solid var(--border-color,#d0d7de); border-radius:5px; padding:.3rem .55rem; color:inherit; background:var(--bg-color,#fff); cursor:pointer; font:inherit; font-size:.82rem; }.uw-btn.primary { color:#fff; background:var(--uw-accent); border-color:var(--uw-accent); }.uw-btn:disabled { opacity:.5; cursor:not-allowed; }.uw-hidden { display:none; } @media (max-width:640px) { .uw-shell { grid-template-columns:1fr; height:auto; max-height:none; overflow:visible; }.uw-explorer { border-right:0; border-bottom:1px solid var(--border-color,#d0d7de); max-height:14rem; }.uw-editor { min-height:30rem; }.uw-bar { flex-wrap:wrap; }.uw-spacer { display:none; } }
</style>
