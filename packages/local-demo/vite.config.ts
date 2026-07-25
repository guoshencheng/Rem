import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const stub = fileURLToPath(new URL('./src/empty-module.ts', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // pi-ai 的 Node-only 间接依赖（浏览器链路不会执行到）
      '@smithy/node-http-handler': stub,
      'http-proxy-agent': stub,
      'https-proxy-agent': stub,
      // bash-parser CLI 入口里的 require('fs')/require('path')（运行时不可达）
      fs: stub,
      path: stub,
    },
  },
});
