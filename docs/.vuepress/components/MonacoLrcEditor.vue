<template>
  <div ref="host" class="monaco-lrc-editor" :aria-label="ariaLabel"><p v-if="loadError" class="monaco-load-error" role="alert">编辑器载入失败。<button type="button" @click="reloadEditor">刷新页面重试</button></p></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: 'lrc' },
  theme: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
  ariaLabel: { type: String, default: 'LRC 源码编辑器' },
});
const emit = defineEmits(['update:modelValue']);
const host = ref(null);
const loadError = ref(false);
const reloadEditor = () => window.location.reload();
let editor;
let model;
let monaco;
let observer;
let media;
let mediaListener;
let syncing = false;
let disposed = false;

function registerLrcLanguage(api) {
  if (!api.languages.getLanguages().some((language) => language.id === 'lrc')) {
    api.languages.register({ id: 'lrc', extensions: ['.lrc', '.elrc'] });
    api.languages.setLanguageConfiguration('lrc', {
      brackets: [['[', ']'], ['<', '>']],
      autoClosingPairs: [{ open: '[', close: ']' }, { open: '<', close: '>' }],
    });
    api.languages.setMonarchTokensProvider('lrc', {
      tokenizer: {
        root: [
          [/^\s*(?:作词|作曲|编曲|演唱|和声|制作|混音|母带|歌词制作|词|曲|编)\s*[:：].*$/, 'credit'],
          [/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/, 'timestamp'],
          [/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/, 'wordTimestamp'],
          [/\[[a-zA-Z][\w-]*:[^\]]*\]/, 'tag'],
        ],
      },
    });
  }
  api.editor.defineTheme('lrc-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'tag', foreground: '79c0ff' },
      { token: 'timestamp', foreground: 'd2a8ff' },
      { token: 'wordTimestamp', foreground: '56d4dd' },
      { token: 'credit', foreground: 'a5d6ff', fontStyle: 'italic' },
      { token: 'section', foreground: 'd2a8ff', fontStyle: 'bold' },
      { token: 'key', foreground: '79c0ff' }, { token: 'trackId', foreground: '56d4dd' },
      { token: 'role', foreground: 'a5d6ff' }, { token: 'url', foreground: '8ddb8c' },
    ], colors: { 'editor.background': '#111113' },
  });
  api.editor.defineTheme('lrc-light', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'tag', foreground: '0451a5' },
      { token: 'timestamp', foreground: '7a3eb1' },
      { token: 'wordTimestamp', foreground: '006d77' },
      { token: 'credit', foreground: '3f5f7a', fontStyle: 'italic' },
      { token: 'section', foreground: '7a3eb1', fontStyle: 'bold' },
      { token: 'key', foreground: '0451a5' }, { token: 'trackId', foreground: '006d77' },
      { token: 'role', foreground: '3f5f7a' }, { token: 'url', foreground: '1a7f37' },
    ],
  });

}

function applyTheme() {
  if (!monaco) return;
  monaco.editor.setTheme(props.theme === 'dark' || (!props.theme && media?.matches) ? 'lrc-dark' : 'lrc-light');
}

onMounted(async () => {
  try {
  const [apiModule, editorWorkerModule, jsonWorkerModule] = await Promise.all([
    import('monaco-editor'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/json/json.worker?worker'),
  ]);
  if (disposed || !host.value) return;
  monaco = apiModule;
  window.MonacoEnvironment = { getWorker: (_, label) => label === 'json' ? new jsonWorkerModule.default() : new editorWorkerModule.default() };
  registerLrcLanguage(monaco);
  media = window.matchMedia('(prefers-color-scheme: dark)');
  mediaListener = () => applyTheme();
  media.addEventListener('change', mediaListener);
  applyTheme();
  model = monaco.editor.createModel(props.modelValue, props.language);
  editor = monaco.editor.create(host.value, {
    model, automaticLayout: false, readOnly: props.readOnly, minimap: { enabled: false },
    fontSize: 13, lineNumbers: 'on', wordWrap: 'on', accessibilitySupport: 'on',
    ariaLabel: props.ariaLabel, scrollBeyondLastLine: false,
  });
  model.onDidChangeContent(() => { if (!syncing) emit('update:modelValue', model.getValue()); });
  observer = new ResizeObserver(() => editor?.layout());
  observer.observe(host.value);
  } catch { if (!disposed) loadError.value = true; }
});

watch(() => props.modelValue, (value) => {
  if (!model || model.getValue() === value) return;
  syncing = true; model.setValue(value); syncing = false;
});
watch(() => props.readOnly, (value) => editor?.updateOptions({ readOnly: value }));
watch(() => props.theme, applyTheme);
watch(() => props.ariaLabel, (value) => editor?.updateOptions({ ariaLabel: value }));
watch(() => props.language, (value) => model && monaco.editor.setModelLanguage(model, value));

onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  media?.removeEventListener('change', mediaListener);
  editor?.dispose(); model?.dispose();
});
</script>

<style scoped>
.monaco-lrc-editor { height: 25rem; border: 1px solid var(--border-color, #ddd); border-radius: 6px; overflow: hidden; text-align: left; }
.monaco-load-error { padding:1rem; font-size:.85rem; }
.monaco-load-error button { color:inherit; background:transparent; border:1px solid var(--border-color); padding:.3rem .5rem; cursor:pointer; }
</style>
