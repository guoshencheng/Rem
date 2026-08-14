import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: {
    'rem-agent-core/live-signals': resolve(import.meta.dirname, '../core/src/domain/event/live-signals.ts'),
    'rem-agent-core': resolve(import.meta.dirname, '../core/src/index.ts'),
  } },
});
