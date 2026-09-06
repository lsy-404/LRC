<template>
  <section class="track-text-view" :data-theme="theme">
    <header><strong>{{ format.toUpperCase() }} 源码</strong><span>{{ locked ? '只读' : '自动关联同轨歌词 · 保存时应用' }}</span></header>
    <MonacoLrcEditor :model-value="source" language="lrc" :theme="theme" :read-only="locked" :aria-label="`${format.toUpperCase()} 源码编辑器`" @update:model-value="editSource" />
    <footer><button type="button" :disabled="locked || !pending" @click="apply">应用修改</button><span v-if="message" :class="{ error }" role="status">{{ message }}</span></footer>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import MonacoLrcEditor from './MonacoLrcEditor.vue';
import { applySourceBuffer, setSourceBuffer, sourceBuffer } from './workspaceEditState.js';
const props = defineProps({ track: { type: Object, required: true }, format: { type: String, default: 'lrc' }, theme: { type: String, default: 'light' }, readOnly: Boolean });
const emit = defineEmits(['update', 'buffer']);
const locked = computed(() => props.readOnly || props.track.authoritativeLrc);
const source = computed(() => sourceBuffer(props.track, props.format));
const pending = computed(() => !!props.track._sourceBuffers?.[props.format]);
const message = ref(''); const error = ref(false);
watch(() => [props.track._id, props.format], () => { message.value = ''; error.value = false; });
function editSource(text) { if (locked.value) return; setSourceBuffer(props.track, props.format, text); emit('buffer', props.track); }
function apply() {
  if (locked.value) return false;
  try { if (applySourceBuffer(props.track, props.format, () => `source-${crypto.randomUUID()}`, text => window.confirm(text))) emit('update', props.track); message.value = '已应用到当前曲目'; error.value = false; return true; }
  catch (e) { message.value = e.message; error.value = true; return false; }
}
defineExpose({ apply });
</script>

<style scoped>
.track-text-view { display:flex; min-height:0; height:100%; flex-direction:column; }.track-text-view header,.track-text-view footer { display:flex; align-items:center; gap:12px; padding:8px 12px; border-bottom:1px solid var(--border-color,#d4d4d8); font-size:12px; }.track-text-view header span { color:var(--ws-muted,#71717a); }.track-text-view :deep(.monaco-lrc-editor) { flex:1; height:auto; min-height:200px; border:0; border-radius:0; }.track-text-view footer { border-top:1px solid var(--border-color,#d4d4d8); border-bottom:0; }.track-text-view button { padding:5px 10px; border:1px solid var(--border-color,#d4d4d8); border-radius:3px; background:var(--bg-color,#fff); color:inherit; font:inherit; cursor:pointer; }.track-text-view button:disabled { opacity:.45; cursor:default; }.error { color:#dc2626; }
</style>
