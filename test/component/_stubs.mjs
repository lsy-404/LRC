// 组件挂载测试的公共垫片：仅在 happy-dom 缺失对应 API 时补齐，不覆盖已有实现。
import { h } from 'vue';

if (typeof globalThis.ResizeObserver === 'undefined') {
  // 布局测量在 happy-dom 里没有意义，观察者本身只需要满足接口形状。
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.URL.createObjectURL !== 'function') {
  let counter = 0;
  globalThis.URL.createObjectURL = () => `blob:happy-dom-${++counter}`;
}
if (typeof globalThis.URL.revokeObjectURL !== 'function') {
  globalThis.URL.revokeObjectURL = () => {};
}

// 少数上传路径用 XMLHttpRequest 而非 fetch 追踪进度；happy-dom 未内建时给出最小可用实现。
if (typeof globalThis.XMLHttpRequest === 'undefined') {
  globalThis.XMLHttpRequest = class XMLHttpRequest {
    open() {}
    send() {}
    setRequestHeader() {}
    addEventListener() {}
  };
}

// MonacoLrcEditor.vue 依赖 Web Worker / Canvas 度量 / ResizeObserver 真实布局，happy-dom 跑不起来。
// 组件对外只暴露 v-model（modelValue）/ language / theme / readOnly / ariaLabel，用 textarea 还原同一接口。
export default {
  name: 'MonacoLrcEditor',
  props: {
    modelValue: { type: String, default: '' },
    language: { type: String, default: 'lrc' },
    theme: { type: String, default: '' },
    readOnly: { type: Boolean, default: false },
    ariaLabel: { type: String, default: 'LRC 源码编辑器' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('textarea', {
      class: 'monaco-lrc-editor-stub',
      'aria-label': props.ariaLabel,
      readonly: props.readOnly,
      '.value': props.modelValue,
      onInput: (event) => emit('update:modelValue', event.target.value),
    });
  },
};
