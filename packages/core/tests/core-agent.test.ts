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
  it('should initialize with idle status', () => {
    const agent = new CoreAgent({
      name: 'test-agent',
      model: createMockModel(),
    });
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

  it('should use default openai provider', async () => {
    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hi' });

    expect(result.content).toBe('Done!');
  });

  it('should retry on retryable API errors', async () => {
    let callCount = 0;
    registerProvider('retryable', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        callCount++;
        if (callCount === 1) {
          throw new Error('rate limit');
        }
        yield { type: 'text', text: 'Recovered!' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const errorHandler = {
      classify: vi.fn().mockReturnValue('api_error'),
      isRetryable: vi.fn().mockReturnValue(true),
      getRetryInstruction: vi.fn().mockReturnValue('Please try again.'),
    };

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      provider: 'retryable',
      providerConfig: { apiKey: 'key', model: 'model' },
      errorHandler: errorHandler as any,
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hi' });

    expect(result.content).toBe('Recovered!');
    expect(callCount).toBe(2);
  });

  it('should stop on non-retryable errors', async () => {
    registerProvider('fatal', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        throw new Error('Fatal');
      },
    });

    const errorHandler = {
      classify: vi.fn().mockReturnValue('unknown'),
      isRetryable: vi.fn().mockReturnValue(false),
      getRetryInstruction: vi.fn(),
    };

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      provider: 'fatal',
      providerConfig: { apiKey: 'key', model: 'model' },
      errorHandler: errorHandler as any,
    });

    await agent.initialize();
    await expect(agent.run({ content: 'Hi' })).rejects.toThrow('Fatal');
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
