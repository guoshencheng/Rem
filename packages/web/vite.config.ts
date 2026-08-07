import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const PORT_FILE = resolve(import.meta.dirname, '.dev-port');

function readServerPort(): number {
  try {
    return Number(readFileSync(PORT_FILE, 'utf-8').trim());
  } catch {
    return 3001;
  }
}

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
    strictPort: false,
    proxy: { '/api': `http://localhost:${readServerPort()}` },
  },
  build: { outDir: 'dist/client' },
});
