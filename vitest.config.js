import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// 组件挂载测试专用配置：只收 test/component 下的用例，
// 与既有 node:test 套件（test/*.test.mjs、test/worker/）完全隔离。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // Monaco 依赖 Web Worker / Canvas 度量 / ResizeObserver，happy-dom 跑不起来；
      // MonacoLrcEditor.vue 对外只暴露 v-model/language/theme/readOnly/ariaLabel，用 textarea stub 替身。
      {
        find: /^.*\/MonacoLrcEditor\.vue$/,
        replacement: fileURLToPath(new URL('./test/component/_stubs.mjs', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'happy-dom',
    include: ['test/component/**/*.test.mjs'],
    globals: false,
  },
});
