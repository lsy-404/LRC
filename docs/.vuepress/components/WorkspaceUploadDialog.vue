<template>
  <div class="workspace-overlay" @keydown.esc.stop="emit('close')" @keydown.tab="trapFocus">
    <section ref="dialog" class="workspace-dialog upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title" tabindex="-1">
      <header><div><strong id="upload-title">上传素材</strong><small>{{ entry.edit.album }} · {{ entry.pendingFiles.length }} 个待保存文件</small></div><button type="button" aria-label="关闭上传窗口" @click="emit('close')">×</button></header>
      <div class="workspace-dialog-body"><section v-if="textEdit" class="upload-text-editor"><header><strong>{{ textEdit.name }}</strong><button type="button" @click="textEdit = null">返回素材</button></header><MonacoLrcEditor :model-value="textEdit.source" language="lrc" @update:model-value="bufferText" :theme="theme" aria-label="素材歌词文本编辑器" /><footer><button type="button" @click="applyText">应用文本修改</button></footer></section><template v-else><AlbumAssetsView :assets="entry.edit.assets" :pending-files="entry.pendingFiles" :tracks="entry.edit.tracks" :uploading="busy" :progress="progress" :read-only="entry.readOnly" :theme="theme" :load-asset="loadAsset" @import="emit('import', $event)" @update="emit('update', $event)" @update-pending="emit('update-pending', $event)" @replace="emit('replace', $event)" />
        <div v-for="item in entry.pendingFiles.filter(item => item.transfer)" :key="item.id" class="upload-transfer"><span>{{ item.name }}</span><progress :value="item.transfer.pct" max="100" :aria-label="`${item.name} 上传进度`" /><span>{{ item.transfer.pct }}%</span></div>
        <div v-for="item in entry.pendingFiles.filter(item => item.role === 'text')" :key="`text-${item.id}`" class="upload-transfer"><span>{{ item.name }}</span><button type="button" :disabled="busy" :aria-label="`编辑文本 ${item.name}`" @click="editText(item)">编辑歌词文本</button></div>
      </template></div>
      <footer><span class="upload-result" :class="{ error: statusError }" role="status">{{ status || '关闭窗口会保留待上传文件' }}</span><button type="button" :disabled="busy || entry.readOnly" @click="emit('save')">{{ uploading ? '上传中…' : '上传并保存' }}</button><button type="button" class="primary" :disabled="busy || entry.readOnly" @click="emit('extract')">{{ entry.origin === 'ingest' ? '保存并继续入库' : '上传并提取' }}</button></footer>
    </section>
  </div>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import AlbumAssetsView from './AlbumAssetsView.vue';
import MonacoLrcEditor from './MonacoLrcEditor.vue';
const props = defineProps({ entry: { type: Object, required: true }, busy: Boolean, uploading: Boolean, progress: String, status: String, statusError: Boolean, theme: String, loadAsset: Function });
const emit = defineEmits(['close', 'import', 'update', 'update-pending', 'replace', 'save', 'extract']);
const dialog = ref(null); const textEdit = ref(null); let previousFocus;
async function editText(item) { textEdit.value = { id: item.id, name: item.name, source: await item.raw.text() }; }
function bufferText(source) { textEdit.value.source = source; const item = textEdit.value; emit('update-pending', props.entry.pendingFiles.map(value => value.id === item.id ? { ...value, raw: new File([source], value.raw.name, { type: 'text/plain' }) } : value)); }
function applyText() { textEdit.value = null; }
function trapFocus(event) { const nodes = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), [tabindex="0"]')]; const first = nodes[0]; const last = nodes.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
onMounted(() => { previousFocus = document.activeElement; dialog.value.focus(); });
onBeforeUnmount(() => { previousFocus?.focus(); });
</script>
