import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreAgent } from '../src/core-agent.js';
import type { AgentStreamChunk } from '../src/types.js';
import { IterationBudget } from '../src/budget.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';
import type { SessionProvider } from '../src/session.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

beforeEach(() => {
  clearProviders();
  registerProvider('openai', {
    generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
    stream: async function* () {
      yield { type: 'text', text: 'Done!' };
      yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    },
    resolveConfig: () => ({ apiKey: 'test-key', model: 'gpt-4o' }),
  });
});

describe('CoreAgent', () => {
  it('should initialize with idle status', async () => {
    const agent = new CoreAgent({
      name: 'test-agent',
      model: createMockModel(),
    });
    await agent.initialize();
    expect(agent.status).toBe('idle');
  });

  it('should run a single turn and complete', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await agent.initialize();
    const result = agent.run({ content: 'Hello' });

    expect((await result.output).content).toBe('Done!');
    expect(agent.status).toBe('idle');
  });

  it('should persist conversation to session', async () => {
    const saveSpy = vi.fn();
    const mockSessionProvider = {
      create: vi.fn().mockResolvedValue({
        sessionId: 's1',
        conversation: [],
        currentTurn: 0,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      load: vi.fn().mockResolvedValue(null),
      save: saveSpy,
    };

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      sessionProvider: mockSessionProvider as SessionProvider,
    });

    await agent.initialize();
    await agent.run({ content: 'Hello' }).output;

    expect(saveSpy).toHaveBeenCalled();
    const savedSession = saveSpy.mock.calls[saveSpy.mock.calls.length - 1][0];
    expect(savedSession.conversation.some((m: any) => m.role === 'user' && m.content === 'Hello')).toBe(true);
    expect(savedSession.conversation.some((m: any) => m.role === 'assistant')).toBe(true);
  });

  it('should load existing session by id', async () => {
    const existingSession = {
      sessionId: 'existing-id',
      conversation: [{ role: 'user', content: 'previous' } as any],
      currentTurn: 1,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockSessionProvider = {
      create: vi.fn(),
      load: vi.fn().mockResolvedValue(existingSession),
      save: vi.fn(),
    };

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      sessionProvider: mockSessionProvider as SessionProvider,
    });

    await agent.initialize({ sessionId: 'existing-id' });
    expect(mockSessionProvider.load).toHaveBeenCalledWith('existing-id');
    expect(agent['state'].conversation).toHaveLength(1);
    expect(agent['state'].conversation[0].content).toBe('previous');
  });

  it('should reset session state', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await agent.initialize();
    await agent.run({ content: 'Hello' }).output;
    expect(agent['state'].conversation.length).toBeGreaterThan(0);

    await agent.reset();
    expect(agent['state'].conversation).toHaveLength(0);
    expect(agent.status).toBe('idle');
  });

  it('should allow event subscription', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    const handler = vi.fn();
    agent.on('core-agent:init', handler);

    await agent.initialize();
    expect(handler).toHaveBeenCalled();
  });

  it('should handle interrupt', async () => {
    registerProvider('slow', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        await new Promise(r => setTimeout(r, 50));
        yield { type: 'text', text: 'Late response' };
      },
    });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      provider: 'slow',
      providerConfig: { apiKey: 'key', model: 'model' },
    });

    const errorHandler = vi.fn();
    agent.on('core-agent:error', errorHandler);

    await agent.initialize();
    const result = agent.run({ content: 'Slow' });
    agent.interrupt();

    const output = await result.output;
    expect(output.content).toContain('interrupted');
  });

  it('should use default openai provider', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    await agent.initialize();
    const result = agent.run({ content: 'Hi' });

    expect((await result.output).content).toBe('Done!');
  });

  it('should use configured provider', async () => {
    registerProvider('mock-agent', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Custom!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      provider: 'mock-agent',
      providerConfig: { apiKey: 'key', model: 'model' },
    });

    await agent.initialize();
    const result = agent.run({ content: 'Hello' });

    expect((await result.output).content).toBe('Custom!');
  });

  it('should enter error state when turn fails', async () => {
    const turnRunner = {
      run: vi.fn().mockRejectedValue(new Error('Turn failed')),
    };
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      turnRunner: turnRunner as any,
    });
    const errorHandler = vi.fn();
    agent.on('core-agent:error', errorHandler);

    await agent.initialize();
    await expect(agent.run({ content: 'Hi' }).output).rejects.toThrow('Turn failed');
    expect(agent.status).toBe('error');
    expect(errorHandler).toHaveBeenCalled();
  });

  it('should expose stream via AgentStreamResult', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
    });
    await agent.initialize();
    const result = agent.run({ content: 'Hello' });

    const chunks: AgentStreamChunk[] = [];
    for await (const chunk of result.stream.fullStream) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true);
    expect(chunks.some((c) => c.type === 'finish')).toBe(true);

    const output = await result.output;
    expect(output.content).toBe('Done!');
  });
});
