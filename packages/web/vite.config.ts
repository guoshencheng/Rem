import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/client'),
      'rem-agent-core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { outDir: 'dist/client' },
});
