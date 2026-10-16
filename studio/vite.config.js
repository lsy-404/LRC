import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 产物并入站点静态资源的 /studio/，与 /api/* 同源，沿用会话 Cookie 与同源校验。
export default defineConfig({
  base: '/studio/',
  build: {
    outDir: fileURLToPath(new URL('../docs/.vuepress/dist/studio', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: { port: 5175, proxy: { '/api': 'http://localhost:8787' } },
  worker: { format: 'es' },
});
