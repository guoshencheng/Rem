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
        if (kind === 'session') return { load: async () => null, save: async () => {} };
        if (kind === 'tool') return { runTool: async (name: string, _args: any) => ({ success: true, result: `${name} result` }) };
        return null;
      },
    } as unknown as ProviderManager;

    const { runAgent } = await import('../src/run-agent.js');
    const result = runAgent({
      input: { content: 'hello' },
      sessionId: 'test-session',
      pm: mockPm,
    });
    expect(result.stream).toBeDefined();
    expect(result.output).toBeInstanceOf(Promise);

    // Consume stream to completion
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
  });
});
