import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    setupFiles: ['packages/core/tests/setup.ts'],
  },
  resolve: {
    alias: [
      { find: 'rem-agent-core/token-usage', replacement: resolve(__dirname, 'packages/core/src/token-usage.ts') },
      { find: 'rem-agent-core/llm/context-window', replacement: resolve(__dirname, 'packages/core/src/llm/context-window.ts') },
      { find: 'rem-agent-core', replacement: resolve(__dirname, 'packages/core/src/index.ts') },
      { find: 'rem-agent-bridge', replacement: resolve(__dirname, 'packages/bridge/src/index.ts') },
      { find: 'rem-agent-tui', replacement: resolve(__dirname, 'packages/tui/src/index.ts') },
      { find: '@/', replacement: resolve(__dirname, 'packages/web/src') },
    ],
  },
});
