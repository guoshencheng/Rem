import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/client'),
      'rem-agent-core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
