<template>
  <section class="album-meta" aria-label="专辑元数据">
    <fieldset :disabled="readOnly">
      <legend>专辑信息</legend>
      <label>投稿类型<select v-model="editor.submissionType" @change="changed"><option value="album">专辑</option><option value="single">单曲</option></select></label>
      <label>专辑名称<input v-model="editor.album" aria-label="专辑名称" maxlength="120" @input="changed"></label>
      <div class="meta-grid">
        <label v-for="field in nameFields" :key="field.key">{{ field.label }}<input v-model="editor.names[field.key]" :aria-label="field.label" @input="changed"></label>
      </div>
      <p class="hint">名称字段用于发行信息；专辑名称用于整理文件。</p>
    </fieldset>
    <fieldset :disabled="readOnly">
      <legend>制作与发行</legend>
      <div class="meta-grid">
        <label v-for="field in META_FIELDS" :key="field.key">{{ field.label }}<input v-model="editor.meta[field.key]" :aria-label="field.label" :placeholder="field.list ? '多位制作人用、分隔' : ''" @input="changed"></label>
      </div>
    </fieldset>
    <fieldset :disabled="readOnly || editor._coverBusy">
      <legend>封面</legend>
      <div class="cover-row">
        <img v-if="!editor.coverRemoved && (editor._coverPreview || coverUrl)" :src="editor._coverPreview || coverUrl" alt="专辑封面">
        <span>{{ editor.coverRemoved ? '封面已移除，保存后生效' : editor.coverExt ? `封面 ${editor.coverExt}` : '尚未设置封面' }}</span>
        <button type="button" @click="coverInput.click()">选择封面</button>
        <button v-if="!editor.coverRemoved && (editor.coverExt || coverUrl)" type="button" @click="emit('cover', null)">移除封面</button>
        <input ref="coverInput" hidden type="file" accept="image/png,image/jpeg,image/webp" @change="pickCover">
      </div>
    </fieldset>
    <section v-if="editor.pages.length" class="pages" aria-label="专辑内页">
      <h3>内页与识别参考</h3>
      <details v-for="(page, index) in editor.pages" :key="page.name || index">
        <summary>{{ page.name || `内页 ${index + 1}` }}</summary>
        <img v-if="pageUrl(page)" :src="pageUrl(page)" :alt="page.name || '专辑内页'">
        <pre>{{ page.text || '无识别文本' }}</pre>
      </details>
    </section>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { META_FIELDS } from './workspaceDocument.js';
const props = defineProps({ editor: { type: Object, required: true }, readOnly: Boolean, theme: String, coverUrl: { type: String, default: '' }, pageUrl: { type: Function, default: () => '' } });
const emit = defineEmits(['update', 'cover']);
const coverInput = ref(null);
const error = ref('');
const nameFields = [{ key: 'prefix', label: '名称前缀' }, { key: 'zh_name', label: '中文名' }, { key: 'en_name', label: '英文名' }, { key: 'suffix', label: '名称后缀' }];
function changed() { if (!props.readOnly) emit('update'); }
function pickCover(event) {
  const file = event.target.files?.[0]; event.target.value = ''; error.value = '';
  if (!file || props.readOnly) return;
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024) { error.value = '请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片'; return; }
  emit('cover', file);
}
</script>

<style scoped>
.album-meta { padding:1.2rem; display:grid; gap:1.25rem; }
fieldset { border:0; padding:0; margin:0; min-width:0; display:grid; gap:.8rem; }
legend,h3 { margin:0 0 .8rem; font-size:.95rem; font-weight:600; }
label { display:flex; flex-direction:column; gap:.3rem; font-size:.85rem; }
input,select,button { border:1px solid var(--border-color,#d0d7de); background:var(--bg-color,#fff); color:inherit; font:inherit; border-radius:4px; padding:.45rem .6rem; min-width:0; }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
.meta-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:.85rem; }
.hint { margin:0; opacity:.65; font-size:.8rem; }
.cover-row { display:flex; flex-wrap:wrap; gap:.65rem; align-items:center; font-size:.85rem; }
.cover-row img { width:100px; height:100px; object-fit:contain; }
details { border-top:1px solid var(--border-color,#d0d7de); padding:.6rem 0; } summary { cursor:pointer; }
.pages img { max-width:100%; max-height:400px; } pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:.85rem; }
[role='alert'] { color:#d73a49; }
</style>
