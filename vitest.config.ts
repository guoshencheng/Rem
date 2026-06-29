import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      'rem-agent-core': resolve(__dirname, 'packages/core/src/index.ts'),
      'rem-agent-bridge': resolve(__dirname, 'packages/bridge/src/index.ts'),
      'rem-agent-server': resolve(__dirname, 'packages/server/src/index.ts'),
      'rem-agent-tui': resolve(__dirname, 'packages/tui/src/index.ts'),
    },
  },
});
