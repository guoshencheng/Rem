import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/core/**/*.test.ts'],
    setupFiles: ['packages/core/tests/setup.ts'],
    coverage: {
      include: ['packages/core/src/**/*.ts'],
      exclude: [
        'archive/**',
        'packages/core/src/**/*.d.ts',
        // 手动 live 脚本，需要真实 LLM API key，无法单元测试
        'packages/core/src/testing/live-agent/run-live-agent.ts',
      ],
    },
  },
  resolve: {
    alias: [
      {
        find: 'rem-agent-core',
        replacement: resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      },
    ],
  },
});
