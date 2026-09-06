<template>
  <section class="workspace" :data-theme="theme" @keydown.meta.s.prevent="saveActive" @keydown.ctrl.s.prevent="saveActive">
    <header class="workspace-bar">
      <strong>歌词工作站</strong><span class="workspace-spacer" />
      <button type="button" :disabled="busy" @click="requestAlbum">新建专辑</button>
      <button type="button" :disabled="busy" @click="openUpload">上传素材<span v-if="activeEntry?.pendingFiles.length"> · {{ activeEntry.pendingFiles.length }}</span></button>
      <button type="button" :disabled="busy || !activeEntry || activeEntry.readOnly" @click="saveActive">{{ busy ? '处理中…' : '保存' }}</button>
      <button type="button" class="primary" :disabled="busy || !activeEntry || activeEntry.readOnly" @click="extractOrContinue">{{ activeEntry?.origin === 'ingest' ? '保存并继续入库' : '提取生成' }}</button>
      <button v-if="user" type="button" @click="$emit('account')">{{ user.display_name || user.name || '账户设置' }}</button><button v-if="user?.role === 'admin'" type="button" @click="$emit('users')">用户管理</button>
    </header>
    <div class="workspace-shell">
      <WorkspaceExplorer :drafts="draftEntries" :pending="visiblePending" :catalog="catalogEntries" :expanded="expanded" :selected-id="activeId" :busy="busy" @refresh="refresh" @create-album="requestAlbum" @create-track="requestTrack" @toggle="toggle" @open="openNode" @open-pending="openPending" @open-catalog="openCatalog" @retry="retryPending" @discard="discardPending" @discard-draft="discardDraft" />
      <main class="workspace-main">
        <WorkspaceTabs :documents="documents" :active-id="activeId" @activate="activate" @close="closeDocument" />
        <section v-if="activeDocument" class="workspace-editor">
          <header class="workspace-editor-head"><span class="workspace-breadcrumb">{{ activeEntry?.edit.album || '工作站' }} / {{ activeDocument.title }}</span><span class="workspace-spacer" /><select v-if="activeEntry" :value="activeDocument.view" aria-label="切换编辑视图" :disabled="busy" @change="switchView($event.target.value)"><option v-for="view in activeViews" :key="view" :value="view">{{ viewLabel(view) }}</option></select></header>
          <div v-if="selectedTrack && linkedTracks.length" class="workspace-sync"><label><input v-model="selectedTrack._syncInstrumental" type="checkbox" :disabled="busy || activeEntry.readOnly || selectedTrack.authoritativeLrc">同步修改伴奏歌词</label><span>{{ linkedTracks.map(track => track.title).join('、') }}</span></div>
          <div class="workspace-content" :class="{ 'source-content': activeDocument.view.startsWith('text:') }" :inert="busy || undefined">
            <slot v-if="activeDocument.view === 'account'" name="account" /><slot v-else-if="activeDocument.view === 'users'" name="users" />
            <TrackTextView v-else-if="selectedTrack && ['text:lrc', 'text:elrc'].includes(activeDocument.view)" :key="`${selectedTrack._id}:${activeDocument.view}`" :track="selectedTrack" :format="activeDocument.view === 'text:elrc' ? 'elrc' : 'lrc'" :theme="theme" :read-only="activeEntry.readOnly" @buffer="bufferTrack" @update="updateTrack" />
            <TrackTimingView v-else-if="selectedTrack && activeDocument.view === 'timing'" :key="selectedTrack._id" :track="selectedTrack" :audio-url="audioUrl" :theme="theme" :read-only="activeEntry.readOnly" @update="updateTrack" />
            <AlbumMetaView v-else-if="activeEntry && activeDocument.view === 'meta'" :editor="activeEntry.edit" :theme="theme" :read-only="activeEntry.readOnly" :cover-url="coverUrl" :page-url="pageUrl" @update="updateAlbum" @cover="updateCover" />
            <AlbumAssetsView v-else-if="activeEntry && activeDocument.view === 'assets'" :assets="activeEntry.edit.assets" :pending-files="activeEntry.pendingFiles" :tracks="activeEntry.edit.tracks" :uploading="uploading" :progress="uploadProgress" :read-only="activeEntry.readOnly" :theme="theme" :load-asset="loadAsset" @import="queueAssets" @update="updateAssets" @update-pending="updatePendingFiles" @replace="replaceAsset" />
            <section v-else-if="activeEntry && activeDocument.view === 'text:json'" class="workspace-json"><MonacoLrcEditor :model-value="jsonSource" language="json" :theme="theme" :read-only="activeEntry.readOnly" aria-label="专辑元数据 JSON 编辑器" @update:model-value="editJson" /><footer><button type="button" :disabled="activeEntry.readOnly" @click="applyJson()">应用 JSON</button><span :class="{ error: jsonError }" role="status">{{ jsonMessage }}</span></footer></section>
          </div>
        </section>
        <div v-else class="workspace-empty"><strong>打开一个文件开始编辑</strong><p>从草稿或成品修改中选择专辑，再打开 meta.json、LRC 或 ELRC。</p><button type="button" @click="requestAlbum">新建专辑</button></div>
      </main>
    </div>
    <footer class="workspace-statusbar"><span :class="{ error: statusError }" role="status">{{ status || '就绪' }}</span><span class="workspace-spacer" /><span v-if="dirtyEntries.length">{{ dirtyEntries.length }} 个专辑未保存</span><span>{{ activeDocument ? viewLabel(activeDocument.view) : '歌词工作区' }}</span></footer>
    <WorkspaceUploadDialog v-if="uploadEntry" :entry="uploadEntry" :busy="busy" :uploading="uploading" :progress="uploadProgress" :status="status" :status-error="statusError" :theme="theme" :load-asset="asset => loadAsset(asset, uploadEntry)" @close="uploadKey = ''" @import="files => queueAssets(files, uploadEntry)" @update="assets => updateAssets(assets, uploadEntry)" @update-pending="files => updatePendingFiles(files, uploadEntry)" @replace="payload => replaceAsset(payload, uploadEntry)" @save="saveActive(uploadEntry)" @extract="extractOrContinue(uploadEntry)" />
    <div v-if="createDialog" class="workspace-overlay" @keydown.esc="createDialog = null"><form class="workspace-dialog create-dialog" role="dialog" aria-modal="true" :aria-label="createDialog.kind === 'track' ? '新建曲目' : '新建专辑'" @submit.prevent="confirmCreate"><header><strong>{{ createDialog.kind === 'track' ? '新建曲目' : '新建专辑' }}</strong><button type="button" aria-label="关闭新建窗口" @click="createDialog = null">×</button></header><label>名称<input v-model="createDialog.name" autofocus required :disabled="busy" aria-label="名称"></label><footer><button type="button" :disabled="busy" @click="createDialog = null">取消</button><button class="primary" :disabled="busy || !createDialog.name.trim()">创建</button></footer></form></div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import WorkspaceExplorer from './WorkspaceExplorer.vue';
import WorkspaceTabs from './WorkspaceTabs.vue';
import WorkspaceUploadDialog from './WorkspaceUploadDialog.vue';
import TrackTextView from './TrackTextView.vue';
import TrackTimingView from './TrackTimingView.vue';
import AlbumMetaView from './AlbumMetaView.vue';
import AlbumAssetsView from './AlbumAssetsView.vue';
import MonacoLrcEditor from './MonacoLrcEditor.vue';
import { createWorkspaceAdapter } from './workspaceAdapter.js';
import * as documentModel from './workspaceDocument.js';
import { applySourceBuffer, nextAssetNumber } from './workspaceEditState.js';
import { uploadFile } from './uploadTransport.js';
import { stripFlacPictureBlocks } from '../lib/flac.js';
const { assetRole, documentId, explorerTree, toDraft, toEdit, viewsFor } = documentModel;
const props = defineProps({ theme: { type: String, default: 'light' }, user: { type: Object, default: null } });
const emit = defineEmits(['unauthorized', 'account', 'users']);
const entries = ref([]); const catalog = ref([]); const pending = ref([]); const documents = ref([]); const activeId = ref(''); const expanded = ref([]);
const busy = ref(false); const uploading = ref(false); const uploadProgress = ref(''); const status = ref(''); const statusError = ref(false); const audioUrl = ref(''); const coverUrl = ref(''); const pageUrls = ref({});
const jsonMessage = ref(''); const jsonError = ref(false); const uploadKey = ref(''); const createDialog = ref(null);
let id = 0; let pollTimer; let refreshing = false; let disposed = false; let mediaAbort; let mediaVersion = 0; const transferAbort = new AbortController();
const newId = () => `workspace-${++id}`;
const api = new Proxy(createWorkspaceAdapter(), { get(target, key) { const value = target[key]; return typeof value !== 'function' ? value : async (...args) => { try { return await value(...args); } catch (error) { if (error?.status === 401) emit('unauthorized'); throw error; } }; } });
const activeDocument = computed(() => documents.value.find(item => item.id === activeId.value));
const activeEntry = computed(() => entries.value.find(item => item.key === activeDocument.value?.entryKey));
const uploadEntry = computed(() => entries.value.find(item => item.key === uploadKey.value));
const selectedTrack = computed(() => activeDocument.value?.resource.kind === 'track' ? activeEntry.value?.edit.tracks[activeDocument.value.resource.index] : null);
const linkedTracks = computed(() => selectedTrack.value ? documentModel.linkedInstrumentalTracks(activeEntry.value.edit, selectedTrack.value) : []);
const activeViews = computed(() => activeEntry.value ? viewsFor(activeDocument.value.resource) : []);
const dirtyEntries = computed(() => entries.value.filter(entry => entry.revision !== entry.savedRevision));
const visiblePending = computed(() => pending.value.filter(item => !entries.value.some(entry => entry.origin === 'ingest' && entry.ref === item.ref && entry.storageAlbum === item.storage_album)));
const explorerEntries = computed(() => entries.value.filter(entry => !(entry.origin === 'workspace' && entry.readOnly && (pending.value.some(item => item.ref === entry.ref) || entries.value.some(item => item.origin === 'ingest' && item.ref === entry.ref)))).map(entry => ({ key: entry.key, origin: entry.origin, group: entry.edit._draft.source?.kind === 'published' ? 'published' : 'draft', slug: entry.edit._draft.source?.slug, ref: entry.ref, storage_album: entry.storageAlbum, owner: entry.owner, state: typeof entry.state === 'string' ? entry.state : entry.state.job || '', message: entry.message || '', readOnly: entry.readOnly, label: entry.edit.album, dirty: entry.revision !== entry.savedRevision, nodes: explorerTree(toDraft(entry.edit), entry) })));
const draftEntries = computed(() => explorerEntries.value.filter(entry => entry.group === 'draft'));
const catalogEntries = computed(() => catalog.value.map(item => ({ ...item, workspace: explorerEntries.value.find(entry => entry.group === 'published' && entry.slug === item.slug) })));
const processingState = value => ['queued', 'dispatching', 'running', 'processing', 'submitted', 'job_started'].includes(value);
const jsonSource = computed(() => activeEntry.value ? activeEntry.value.jsonBuffer ?? JSON.stringify(toDraft(activeEntry.value.edit), null, 2) + '\n' : '');
function setStatus(message = '', error = false) { status.value = message; statusError.value = error; }
function entryFrom(origin, refValue, storageAlbum, draft, state = '') { const locked = typeof state === 'object' ? !!(state.submitted || state.job_started || ['starting', 'queued', 'running', 'dispatching'].includes(state.job?.state || state.job)) : ['submitted', 'job_started', 'processing'].includes(state); return { key: origin === 'workspace' ? `${origin}:${refValue}` : `${origin}:${refValue}:${storageAlbum}`, origin, ref: refValue, storageAlbum, readOnly: locked, state, owner: typeof state === 'object' ? state.owner || '' : '', message: '', edit: toEdit(storageAlbum, draft, newId), pendingFiles: [], revision: 0, savedRevision: 0, dirtyResources: [], jsonBuffer: null, coverFile: null }; }
function replaceEntry(next) {
  const current = entries.value.find(item => item.key === next.key);
  if (!current) { entries.value.unshift(next); return entries.value[0]; }
  current.readOnly = next.readOnly; current.state = next.state; current.owner = next.owner || current.owner;
  const opened = documents.value.some(doc => doc.entryKey === current.key) || uploadKey.value === current.key;
  if (current.revision === current.savedRevision && !busy.value && !opened && !current.pendingFiles.length) current.edit = next.edit;
  return current;
}
function refreshDocumentTitles(entry) {
  const root = explorerTree(toDraft(entry.edit), entry)[0];
  const nodes = [root, ...root.children, ...root.children.flatMap(node => node.children || [])];
  for (const doc of documents.value.filter(item => item.entryKey === entry.key)) {
    const node = nodes.find(node => node.id === doc.id); if (node) doc.title = node.label;
  }
}
function markDirty(entry = activeEntry.value, resource = activeDocument.value?.resource) {
  if (!entry || entry.readOnly) return;
  entry.revision += 1;
  const key = resource?.kind === 'track' ? `track:${resource.index}` : 'album';
  if (!entry.dirtyResources.includes(key)) entry.dirtyResources.push(key);
  for (const doc of documents.value.filter(item => item.entryKey === entry.key)) doc.dirty = doc.resource.kind === 'album' || entry.dirtyResources.includes(`track:${doc.resource.index}`);
}
function applyTrackBuffers(entry, track) {
  for (const format of Object.keys(track._sourceBuffers || {})) if (applySourceBuffer(track, format, newId, text => window.confirm(text))) updateTrack(track, entry);
}
function flushCurrent() {
  try {
    if (!activeEntry.value) return true;
    if (activeDocument.value.view === 'text:json' && activeEntry.value.jsonBuffer !== null) return applyJson(activeEntry.value);
    if (selectedTrack.value) applyTrackBuffers(activeEntry.value, selectedTrack.value);
    return true;
  } catch (error) { setStatus(`请先修正当前文件：${error.message}`, true); return false; }
}
function openNode(node, entryKey) {
  const initialView = node.view;
  if (node.resource.kind === 'album' && node.view === 'meta') node = { ...node, label: 'meta.json', view: 'text:json' };
  if (busy.value || !flushCurrent()) return;
  const entry = entries.value.find(item => entryKey ? item.key === entryKey : item.origin === node.resource.origin && item.ref === node.resource.ref && item.storageAlbum === node.resource.storageAlbum);
  if (!entry) return;
  const targetId = documentId(node.resource, node.view);
  let doc = documents.value.find(item => item.id === targetId);
  if (!doc) {
    doc = { id: targetId, resource: node.resource, fileView: node.view, view: initialView, title: node.label, entryKey: entry.key, dirty: entry.revision !== entry.savedRevision && (node.resource.kind === 'album' || entry.dirtyResources.includes(`track:${node.resource.index}`)) };
    documents.value.push(doc);
  }
  activeId.value = doc.id;
}
function activate(value) { if (!busy.value && flushCurrent()) activeId.value = value; }
function switchView(view) { if (!busy.value && activeDocument.value && flushCurrent()) activeDocument.value.view = view; }
function closeDocument(value) {
  if (busy.value) return;
  const index = documents.value.findIndex(item => item.id === value); const doc = documents.value[index]; if (!doc) return;
  if (doc.dirty && !window.confirm(`「${doc.title}」尚未保存。关闭标签后修改仍保留在工作区，继续关闭吗？`)) return;
  documents.value.splice(index, 1);
  if (activeId.value === value) activeId.value = documents.value[index]?.id || documents.value[index - 1]?.id || '';
}
function bufferTrack(track) { const index = activeEntry.value.edit.tracks.indexOf(track); markDirty(activeEntry.value, { kind: 'track', index }); }
function updateTrack(track, entry = activeEntry.value) {
  if (!track || !entry || entry.readOnly) return;
  const index = entry.edit.tracks.findIndex(item => item._id === track._id); if (index < 0) return;
  if (entry.edit.tracks[index] !== track) entry.edit.tracks.splice(index, 1, track);
  markDirty(entry, { kind: 'track', index }); refreshDocumentTitles(entry);
  if (track._syncInstrumental && !track.authoritativeLrc) {
    const targets = documentModel.linkedInstrumentalTracks(entry.edit, track);
    for (const synced of documentModel.syncInstrumentalLyrics(entry.edit, track, targets.map(item => item._id), newId)) markDirty(entry, { kind: 'track', index: entry.edit.tracks.indexOf(synced) });
  }
}
function updateAlbum() { markDirty(); refreshDocumentTitles(activeEntry.value); }
function updateAssets(assets, entry = activeEntry.value) { if (!entry || entry.readOnly) return; entry.edit.assets = assets; markDirty(entry, { kind: 'album' }); }
function updatePendingFiles(files, entry = activeEntry.value) { if (!entry || entry.readOnly) return; entry.pendingFiles = files.map(item => { const old = entry.pendingFiles.find(value => value.id === item.id); return old && old.raw !== item.raw ? { ...item, transfer: undefined, uploaded: false } : item; }); markDirty(entry, { kind: 'album' }); }
function replaceAsset(payload, entry = activeEntry.value) {
  if (!entry || entry.readOnly) return;
  const previous = entry.pendingFiles.findIndex(item => item.replace?.n === payload.asset.n);
  const replacement = { id: newId(), raw: payload.file, name: payload.path, path: payload.path, role: payload.asset.role, linkTo: [...(payload.asset.linkTo || [])], replace: payload.asset };
  if (previous >= 0) entry.pendingFiles.splice(previous, 1, replacement); else entry.pendingFiles.push(replacement);
  markDirty(entry, { kind: 'album' });
}
function toggle(key) { expanded.value = expanded.value.includes(key) ? expanded.value.filter(item => item !== key) : [...expanded.value, key]; }
function viewLabel(view) { return ({ timing: '调轴', 'text:lrc': 'LRC 源码', 'text:elrc': 'ELRC 源码', meta: '元数据', 'text:json': 'JSON 源码', assets: '素材', account: '账户设置', users: '用户管理' })[view] || view; }
function editJson(text) { if (!activeEntry.value || activeEntry.value.readOnly) return; activeEntry.value.jsonBuffer = text; jsonMessage.value = ''; markDirty(); }
function applyJson(entry = activeEntry.value) {
  if (!entry || entry.readOnly || entry.jsonBuffer === null) return true;
  try {
    const next = JSON.parse(entry.jsonBuffer);
    if (!next || typeof next !== 'object' || Array.isArray(next) || !Array.isArray(next.tracks) || (next.meta && (typeof next.meta !== 'object' || Array.isArray(next.meta)))) throw new Error('需要专辑对象、meta 对象和 tracks 数组');
    for (const field of documentModel.META_FIELDS.filter(item => item.list)) if (next.meta?.[field.key] !== undefined && !Array.isArray(next.meta[field.key])) throw new Error(`${field.key} 必须是数组`);
    for (const [index, track] of entry.edit.tracks.entries()) if (track.authoritativeLrc && next.tracks[index]) {
      for (const key of ['lrc', 'klrc', 'lines', 'vocals', 'timing_locked', 'authoritative_lrc']) next.tracks[index][key] = track._orig[key];
    }
    entry.edit = toEdit(entry.storageAlbum, next, newId); entry.jsonBuffer = null; markDirty(entry, { kind: 'album' });
    documents.value = documents.value.filter(doc => doc.entryKey !== entry.key || doc.resource.kind !== 'track' || doc.resource.index < entry.edit.tracks.length);
    for (const doc of documents.value.filter(item => item.entryKey === entry.key)) doc.dirty = true;
    refreshDocumentTitles(entry);
    jsonMessage.value = '已应用'; jsonError.value = false; return true;
  } catch (error) { jsonMessage.value = `JSON 格式错误：${error.message}`; jsonError.value = true; setStatus(jsonMessage.value, true); return false; }
}
async function refresh() {
  if (refreshing || disposed) return; refreshing = true;
  try {
    const [listed, published, reviewing] = await Promise.all([api.list(), api.catalog(), api.pending()]);
    if (disposed) return; catalog.value = published.albums || []; pending.value = reviewing.pending || [];
    const drafts = await Promise.all((listed.workspaces || []).map(item => api.draft(item.ref)));
    if (disposed) return;
    for (const item of drafts) replaceEntry(entryFrom('workspace', item.ref, item.draft.album || item.ref, item.draft, item.status || listed.workspaces.find(value => value.ref === item.ref)?.status));
    for (const entry of entries.value.filter(item => item.origin === 'ingest')) {
      const latest = pending.value.find(item => item.ref === entry.ref && item.storage_album === entry.storageAlbum);
      if (latest) { entry.state = latest.state || latest.status; entry.message = latest.message || ''; entry.owner = latest.owner || entry.owner; entry.readOnly = processingState(entry.state) || entry.state === 'failed' || entry.state === 'done'; }
    }
  } catch (error) { if (!disposed) setStatus(`读取失败：${error.message || '网络错误'}`, true); } finally { refreshing = false; }
}
function requestAlbum(afterUpload = false) { if (!busy.value) createDialog.value = { kind: 'album', name: '', afterUpload: afterUpload === true }; }
function requestTrack(key) { const entry = entries.value.find(item => item.key === key) || activeEntry.value; if (!entry) return requestAlbum(); if (!busy.value && flushCurrent()) createDialog.value = { kind: 'track', name: '', entryKey: entry.key }; }
async function confirmCreate() {
  const dialog = createDialog.value; if (!dialog || busy.value || !dialog.name.trim()) return;
  busy.value = true;
  try {
    let entry; let node;
    if (dialog.kind === 'track') {
      entry = entries.value.find(item => item.key === dialog.entryKey);
      if (entry.origin !== 'workspace') throw new Error('审核任务不能添加新曲目');
      const result = await api.lrc(entry.ref, dialog.name.trim());
      const track = toEdit(entry.storageAlbum, { tracks: [result.track] }, newId).tracks[0];
      track.order = Math.max(0, ...entry.edit.tracks.map(item => Number(item.order) || 0)) + 1;
      entry.edit.tracks.push(track); markDirty(entry, { kind: 'track', index: entry.edit.tracks.length - 1 });
      node = explorerTree(toDraft(entry.edit), entry)[0].children.at(-1);
    } else {
      const result = await api.create(dialog.name.trim());
      entry = replaceEntry(entryFrom('workspace', result.ref, result.draft.album || dialog.name.trim(), result.draft));
      node = explorerTree(toDraft(entry.edit), entry)[0];
    }
    if (!expanded.value.includes(entry.key)) expanded.value.push(entry.key);
    createDialog.value = null; busy.value = false; openNode(node, entry.key); if (dialog.afterUpload) uploadKey.value = entry.key;
  } catch (error) { setStatus(`创建失败：${error.message}`, true); } finally { busy.value = false; }
}
async function openCatalog(item) {
  if (busy.value || !flushCurrent()) return;
  try { const result = await api.open(item.slug); const entry = replaceEntry(entryFrom('workspace', result.ref, result.draft.album || item.slug, result.draft)); if (!expanded.value.includes(entry.key)) expanded.value.push(entry.key); openNode(explorerTree(toDraft(entry.edit), entry)[0], entry.key); } catch (error) { setStatus(`打开失败：${error.message}`, true); }
}
async function openPending(item) {
  if (busy.value || !flushCurrent()) return;
  try { const data = await api.state(item.ref); const album = (data.albums || []).find(candidate => candidate.storage_album === item.storage_album) || data.albums?.[0]; if (!album?.draft) throw new Error('该审核任务尚不可编辑'); const entry = replaceEntry(entryFrom('ingest', item.ref, album.storage_album, album.draft, data.status)); entry.owner = item.owner || album.status?.owner || ''; for (const original of entries.value.filter(value => value.origin === 'workspace' && value.ref === item.ref && value.readOnly)) removeEntry(original); if (!expanded.value.includes(entry.key)) expanded.value.push(entry.key); openNode(explorerTree(toDraft(entry.edit), entry)[0], entry.key); } catch (error) { setStatus(`打开审核稿失败：${error.message}`, true); }
}
async function retryPending(item) { try { await api.retry(item.ref); await refresh(); } catch (error) { setStatus(`重试失败：${error.message}`, true); } }
function removeEntry(entry) { entries.value = entries.value.filter(item => item.key !== entry.key); documents.value = documents.value.filter(doc => doc.entryKey !== entry.key); if (!activeDocument.value) activeId.value = documents.value.at(-1)?.id || ''; }
async function discardPending(item) { if (!window.confirm(`丢弃「${item.album}」的审核草稿及未保存修改？`)) return; try { await api.discard(item.ref, item.storage_album); for (const entry of entries.value.filter(entry => entry.origin === 'ingest' && entry.ref === item.ref && entry.storageAlbum === item.storage_album)) removeEntry(entry); await refresh(); } catch (error) { setStatus(`丢弃失败：${error.message}`, true); } }
async function discardDraft(key) { const entry = entries.value.find(item => item.key === key); if (!entry || busy.value || !window.confirm(`丢弃「${entry.edit.album}」的草稿及未保存修改？`)) return; try { if (entry.origin === 'ingest') await api.discard(entry.ref, entry.storageAlbum); else await api.workspaceDiscard(entry.ref); removeEntry(entry); await refresh(); } catch (error) { setStatus(`丢弃失败：${error.message}`, true); } }
function openUpload() { if (activeEntry.value) uploadKey.value = activeEntry.value.key; else requestAlbum(true); }
function queueAssets(files, entry = activeEntry.value) {
  if (!entry || entry.readOnly || uploading.value) return;
  const known = new Set([...entry.edit.assets.map(item => item.path), ...entry.pendingFiles.map(item => item.path || item.name)].map(name => String(name).toLowerCase()));
  for (const raw of Array.from(files || [])) {
    const path = raw.webkitRelativePath || raw.name;
    if (known.has(path.toLowerCase())) { setStatus(`已存在同名素材：${path}`, true); continue; }
    known.add(path.toLowerCase()); entry.pendingFiles.push({ id: newId(), raw, name: path, path, role: assetRole(path), linkTo: [] });
  }
  markDirty(entry, { kind: 'album' });
}
async function saveActive(requestedEntry) {
  const entry = requestedEntry?.edit ? requestedEntry : activeEntry.value;
  if (!entry || entry.readOnly || busy.value) return false;
  try { if (!applyJson(entry)) return false; for (const track of entry.edit.tracks) applyTrackBuffers(entry, track); } catch (error) { setStatus(`保存失败：${error.message}`, true); return false; }
  busy.value = true;
  try {
    if (entry.pendingFiles.length) await uploadPending(entry);
    if (entry.coverFile && entry.origin === 'ingest') { await api.cover(entry.ref, entry.storageAlbum, entry.edit.coverExt, entry.coverFile); entry.coverFile = null; }
    const revision = entry.revision; const draft = toDraft(entry.edit);
    if (entry.origin === 'ingest') await api.saveReview(entry.ref, entry.storageAlbum, draft); else await api.save(entry.ref, draft);
    entry.savedRevision = revision; entry.edit._draft = draft;
    if (entry.revision === revision) { entry.dirtyResources = []; for (const doc of documents.value.filter(item => item.entryKey === entry.key)) doc.dirty = false; }
    setStatus('已保存'); return true;
  } catch (error) { setStatus(`保存失败：${error.message || '网络错误'}`, true); return false; } finally { busy.value = false; }
}
async function extractOrContinue(requestedEntry) {
  const entry = requestedEntry?.edit ? requestedEntry : activeEntry.value;
  if (!entry || !(await saveActive(entry))) return;
  busy.value = true;
  try { if (entry.origin === 'ingest') await api.continue(entry.ref); else await api.extract(entry.ref); entry.readOnly = true; entry.state = 'submitted'; setStatus(entry.origin === 'ingest' ? '已保存并继续入库' : '已开始提取生成'); await refresh(); } catch (error) { setStatus(`操作失败：${error.message || '网络错误'}`, true); } finally { busy.value = false; }
}
async function uploadPending(entry) {
  uploading.value = true;
  try {
    for (const item of [...entry.pendingFiles]) {
      item.transfer ||= { n: nextAssetNumber(entry), file: item.raw, size: item.raw.size, pct: 0, multipart: null };
      uploadProgress.value = `正在上传 ${item.name}`;
      if (!item.uploaded) {
        const ok = await uploadFile(item.transfer, { session: entry.ref, signal: transferAbort.signal, onUnauthorized: () => emit('unauthorized') });
        if (!ok) throw new Error(`「${item.name}」上传失败，队列已保留，可重试`);
        item.uploaded = true;
      }
      const asset = { n: item.transfer.n, path: item.path || item.name, role: item.role, size: item.raw.size, linkTo: [...(item.linkTo || [])] };
      if (entry.origin === 'workspace') await api.asset(entry.ref, asset);
      const oldIndex = item.replace ? entry.edit.assets.findIndex(value => value.n === item.replace.n) : entry.edit.assets.findIndex(value => value.n === asset.n);
      if (oldIndex >= 0) entry.edit.assets.splice(oldIndex, 1, asset); else entry.edit.assets.push(asset);
      if (asset.role === 'cover') { entry.edit.coverExt = (asset.path.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase(); entry.edit.coverRemoved = false; }
      entry.pendingFiles = entry.pendingFiles.filter(value => value.id !== item.id);
    }
  } finally { uploading.value = false; uploadProgress.value = ''; }
}
function updateCover(file) {
  const entry = activeEntry.value; if (!entry || entry.readOnly) return;
  if (entry.edit._coverPreview) URL.revokeObjectURL(entry.edit._coverPreview);
  entry.edit._coverPreview = file ? URL.createObjectURL(file) : '';
  entry.edit.coverRemoved = !file; entry.coverFile = entry.origin === 'ingest' ? file : null;
  entry.pendingFiles = entry.pendingFiles.filter(item => item.role !== 'cover');
  entry.edit.assets = entry.edit.assets.filter(item => item.role !== 'cover');
  if (file) {
    entry.edit.coverExt = (file.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
    if (entry.origin === 'workspace') entry.pendingFiles.push({ id: newId(), raw: file, name: file.name, path: file.name, role: 'cover', linkTo: ['SP'] });
  }
  markDirty(entry, { kind: 'album' });
}
async function loadAsset(asset, entry = activeEntry.value) {
  if (!entry) throw new Error('请先打开专辑');
  const response = entry.origin === 'workspace' ? await api.workspaceMedia(entry.ref, asset.n) : await api.reviewMedia(entry.ref, asset.path);
  return new File([await response.blob()], String(asset.path || 'image.png').split('/').pop(), { type: response.headers.get('content-type') || 'image/png' });
}
async function loadMedia() {
  cleanupMedia(); const version = mediaVersion; const controller = new AbortController(); mediaAbort = controller;
  const entry = activeEntry.value; const doc = activeDocument.value; if (!entry || !doc) return;
  const keep = async (response, assign, audio = false) => { const raw = await response.blob(); const blob = audio ? await stripFlacPictureBlocks(raw) : raw; if (disposed || version !== mediaVersion) return; assign(URL.createObjectURL(blob)); };
  try {
    if (doc.view === 'timing') {
      const track = selectedTrack.value; track._audioLoading = true; track._audioErr = '';
      const songs = entry.edit.assets.filter(item => item.role === 'song');
      const asset = songs.find(item => track.audio && (item.path === track.audio || item.path.split('/').pop() === track.audio)) || songs.find(item => item.linkTo?.includes(Number(track.order))) || songs[doc.resource.index];
      if (entry.origin === 'workspace' && asset) await keep(await api.workspaceAudio(entry.ref, asset.n, controller.signal), url => { audioUrl.value = url; }, true);
      else if (entry.origin === 'ingest' && track.audio) await keep(await api.audio(entry.ref, track.audio, controller.signal), url => { audioUrl.value = url; }, true);
      if (version === mediaVersion) track._audioLoading = false;
    }
    if (doc.view === 'meta') {
      await Promise.all(entry.edit.pages.filter(page => /\.(png|jpe?g|webp|gif|bmp)$/i.test(page.name || '')).map(async page => {
        try {
          const asset = entry.edit.assets.find(item => item.path === page.name || item.path.split('/').pop() === page.name);
          if (entry.origin === 'workspace' && !asset) return;
          const response = entry.origin === 'workspace' ? await api.workspaceMedia(entry.ref, asset.n, controller.signal) : await api.reviewMedia(entry.ref, page.name, controller.signal);
          await keep(response, url => { pageUrls.value[page.name] = url; });
        } catch (error) { if (error.status !== 404 && error.name !== 'AbortError') throw error; }
      }));
    }
    if (doc.view === 'meta' && !entry.edit.coverRemoved && entry.edit.coverExt && !entry.edit._coverPreview) {
      const response = entry.origin === 'workspace' ? await api.workspaceCover(entry.ref, controller.signal) : await api.reviewCover(entry.ref, entry.storageAlbum, controller.signal);
      await keep(response, url => { coverUrl.value = url; });
    }
  } catch (error) { if (error.name !== 'AbortError' && version === mediaVersion && !disposed) { if (selectedTrack.value) { selectedTrack.value._audioLoading = false; selectedTrack.value._audioErr = error.message; } setStatus(`素材加载失败：${error.message}`, true); } }
}
function cleanupMedia() { mediaAbort?.abort(); mediaAbort = null; mediaVersion += 1; for (const url of [audioUrl.value, coverUrl.value, ...Object.values(pageUrls.value)].filter(Boolean)) URL.revokeObjectURL(url); audioUrl.value = ''; coverUrl.value = ''; pageUrls.value = {}; }
function pageUrl(page) { return pageUrls.value[page.name] || ''; }
function canLeave() { return !dirtyEntries.value.length || window.confirm('存在未保存修改或上传队列，确定离开吗？'); }
function openVirtualView(view) { if (!['account', 'users'].includes(view) || !flushCurrent()) return; let doc = documents.value.find(item => item.id === `virtual:${view}`); if (!doc) { doc = { id: `virtual:${view}`, resource: { kind: 'virtual' }, view, title: viewLabel(view), entryKey: '', dirty: false }; documents.value.push(doc); } activeId.value = doc.id; }
function leaveWarning(event) { if (!dirtyEntries.value.length) return; event.preventDefault(); event.returnValue = ''; }
watch(() => [activeId.value, activeDocument.value?.view, selectedTrack.value?._id], () => { jsonMessage.value = ''; jsonError.value = false; loadMedia(); });
defineExpose({ canLeave, openVirtualView });
onMounted(() => { refresh(); pollTimer = setInterval(refresh, 12000); window.addEventListener('beforeunload', leaveWarning); });
onBeforeUnmount(() => { disposed = true; clearInterval(pollTimer); transferAbort.abort(); cleanupMedia(); for (const entry of entries.value) if (entry.edit._coverPreview) URL.revokeObjectURL(entry.edit._coverPreview); window.removeEventListener('beforeunload', leaveWarning); });
</script>

<style src="./workspace.css"></style>
