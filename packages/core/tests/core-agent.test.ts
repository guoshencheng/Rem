import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreAgent } from '../src/core-agent.js';
import { IterationBudget } from '../src/budget.js';
import * as ai from 'ai';

vi.mock('ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('ai')>();
  return {
    ...mod,
    generateText: vi.fn(),
  };
});

function mockResponse(text: string, toolCalls: any[] = []): any {
  return {
    text,
    toolCalls,
    toolResults: [],
    usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 5, reasoningTokens: 0 } },
    finishReason: toolCalls.length > 0 ? 'tool-calls' : 'stop',
    rawFinishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    staticToolResults: [],
    dynamicToolResults: [],
    totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 5, reasoningTokens: 0 } },
    warnings: [],
    response: { id: 'test', timestamp: new Date(), modelId: 'test' },
    request: {},
    providerMetadata: {},
    logprobs: undefined,
    textDelta: '',
    content: [],
  };
}

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

describe('CoreAgent', () => {
  beforeEach(() => {
    vi.mocked(ai.generateText).mockClear();
  });
  it('should initialize with idle status', () => {
    const agent = new CoreAgent({
      name: 'test-agent',
      model: createMockModel(),
    });
    expect(agent.status).toBe('idle');
  });

  it('should run a single turn and complete', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockResponse('Done!'));

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
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockResponse('OK'));

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
    vi.mocked(ai.generateText).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50));
      return mockResponse('Late response');
    });

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    await agent.initialize();
    const runPromise = agent.run({ content: 'Slow' });
    agent.interrupt();

    const result = await runPromise;
    expect(result.content).toContain('interrupted');
  });

  it('should inject default providers when not specified', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockResponse('Hello!'));

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hi' });

    expect(result.content).toBe('Hello!');
  });

  it('should retry on retryable API errors', async () => {
    const errorHandler = {
      classify: vi.fn().mockReturnValue('api_error'),
      isRetryable: vi.fn().mockReturnValue(true),
      getRetryInstruction: vi.fn().mockReturnValue('Please try again.'),
    };

    vi.mocked(ai.generateText)
      .mockRejectedValueOnce(new ai.APICallError({ message: 'rate limit', url: 'http://test' }))
      .mockResolvedValueOnce(mockResponse('Recovered!'));

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      budget: new IterationBudget({ maxTurns: 5 }),
      errorHandler: errorHandler as any,
    });

    await agent.initialize();
    const result = await agent.run({ content: 'Hi' });

    expect(result.content).toBe('Recovered!');
    expect(ai.generateText).toHaveBeenCalledTimes(2);
  });

  it('should stop on non-retryable errors', async () => {
    const errorHandler = {
      classify: vi.fn().mockReturnValue('unknown'),
      isRetryable: vi.fn().mockReturnValue(false),
      getRetryInstruction: vi.fn(),
    };

    vi.mocked(ai.generateText).mockRejectedValueOnce(new Error('Fatal'));

    const agent = new CoreAgent({
      name: 'test',
      model: createMockModel(),
      errorHandler: errorHandler as any,
    });

    await agent.initialize();
    await expect(agent.run({ content: 'Hi' })).rejects.toThrow('Fatal');
  });
});
