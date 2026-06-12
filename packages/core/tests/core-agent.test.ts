import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreAgent } from '../src/core-agent.js';
import { IterationBudget } from '../src/budget.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

beforeEach(() => {
  clearProviders();
  registerProvider('openai', {
    generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
    stream: async function* () {
      yield { type: 'text', text: 'Done!' };
      yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    },
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
    const result = await agent.run({ content: 'Hello' });

    expect(result.content).toBe('Done!');
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
      sessionProvider: mockSessionProvider as any,
    });

    await agent.initialize();
    await agent.run({ content: 'Hello' });

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
      sessionProvider: mockSessionProvider as any,
    });

    await agent.initialize({ sessionId: 'existing-id' });
    expect(mockSessionProvider.load).toHaveBeenCalledWith('existing-id');
  });

  it('should reset session state', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await agent.initialize();
    await agent.run({ content: 'Hello' });
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

    await agent.initialize();
    const runPromise = agent.run({ content: 'Slow' });
    agent.interrupt();

    const result = await runPromise;
    expect(result.content).toContain('interrupted');
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
    const result = await agent.run({ content: 'Hello' });

    expect(result.content).toBe('Custom!');
  });
});
