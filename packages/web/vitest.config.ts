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
      'rem-agent-core/live-signals': resolve(import.meta.dirname, '../core/src/domain/event/live-signals.ts'),
      'rem-agent-core': resolve(import.meta.dirname, '../core/src/index.ts'),
      'rem-agent-client': resolve(import.meta.dirname, '../client/src/index.ts'),
      'rem-agent-service': resolve(import.meta.dirname, '../service/src/index.ts'),
    },
  },
});
