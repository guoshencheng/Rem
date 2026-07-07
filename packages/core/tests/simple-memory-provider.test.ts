import { describe, it, expect } from 'vitest';
import { SimpleMemoryProvider } from '../src/plugins/memory/simple/index.js';
import type { Session } from '../src/session.js';
import type { ModelMessage } from '../src/types.js';
import type { ConfigProvider } from '../src/sdk/config-provider.js';

function mockConfigProvider(name: string): ConfigProvider {
  return {
    getBehaviorConfig: () => ({
      name,
      maxTurns: 60,
      workspaceRoot: '/tmp',
      readOnly: false,
      autoApproveDangerous: false,
      sessionsDir: '/tmp/.sessions',
    }),
    getModelConfig: () => ({ provider: 'openai', model: '', apiKey: '' }),
    getToolConfig: () => ({}),
    getMcpConfig: () => ({}),
    getConfig: () => ({
      name, maxTurns: 60, workspaceRoot: '/tmp', readOnly: false,
      autoApproveDangerous: false, sessionsDir: '/tmp/.sessions',
      model: { provider: 'openai', model: '', apiKey: '' },
    }),
  };
}

function makeSession(conversation: ModelMessage[] = []): Session {
  return {
    sessionId: 's1',
    conversation,
    currentTurn: 0,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('SimpleMemoryProvider', () => {
  it('should build context with system prompt and conversation', async () => {
    const provider = new SimpleMemoryProvider(mockConfigProvider('TestAgent'));
    const session = makeSession([{ id: '1', role: 'user', content: [{ type: 'text', text: 'Hello' }] }]);

    const ctx = await provider.buildContext(session, 'TestAgent');

    expect(ctx.systemPrompt).toBe('You are TestAgent.');
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].role).toBe('user');
  });

  it('should return empty messages for fresh session', async () => {
    const provider = new SimpleMemoryProvider(mockConfigProvider('Agent'));
    const session = makeSession();

    const ctx = await provider.buildContext(session, 'Agent');

    expect(ctx.messages).toHaveLength(0);
  });
});
