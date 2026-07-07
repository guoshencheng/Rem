import { describe, it, expect } from 'vitest';
import type { ProviderManager } from '../src/provider-manager.js';

describe('runAgent', () => {
  it('returns a stream and output promise', async () => {
    const mockPm = {
      getBehaviorConfig: () => ({ name: 'test', maxTurns: 1, workspaceRoot: '/tmp', readOnly: false, sessionsDir: '/tmp/.sessions' }),
      getModelConfig: () => ({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseURL: undefined }),
      getConfigProvider: () => ({}),
      get: () => null,
      require: (kind: string) => {
        if (kind === 'session') {
          return { load: async () => null, save: async () => {} };
        }
        if (kind === 'context') {
          return { build: async () => ({ system: 'You are test.', messages: [] }) };
        }
        if (kind === 'compressor') {
          return { shouldCompress: () => false, compress: async (msgs: unknown[]) => msgs };
        }
        if (kind === 'loopStrategy') {
          return {
            run: async () => ({
              content: 'hello back',
              newMessages: [],
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            }),
          };
        }
        if (kind === 'tool') {
          return { getToolSet: () => ({}), execute: async () => [] };
        }
        return null;
      },
    } as unknown as ProviderManager;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello', timestamp: new Date() },
      sessionId: 'test-session',
      pm: mockPm,
    });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);

    // Consume stream to completion
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }

    const output = await result.output;
    expect(output.completed).toBe(true);
  });
});
