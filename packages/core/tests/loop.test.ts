import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from '../src/loop.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import * as ai from 'ai';

vi.mock('ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('ai')>();
  return {
    ...mod,
    generateText: vi.fn(),
  };
});

function mockGenerateTextResponse(text: string, toolCalls: any[] = []): any {
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

const createMockProviders = () => ({
  toolProvider: {
    getToolSet: vi.fn().mockReturnValue({}),
    execute: vi.fn().mockResolvedValue([]),
  },
  memoryProvider: {
    buildContext: vi.fn().mockResolvedValue({
      systemPrompt: 'You are test',
      messages: [],
    }),
  },
  compressor: {
    shouldCompress: vi.fn().mockReturnValue(false),
    compress: vi.fn().mockImplementation(async (msgs: any[]) => msgs),
  },
});

describe('AgentLoop', () => {
  it('should execute a simple turn without tools', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('Hello!'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const mocks = createMockProviders();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are helpful',
      availableTools: {},
    }, state);

    expect(result.output.content).toBe('Hello!');
    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  it('should emit turn events', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('OK'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();

    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const mocks = createMockProviders();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);
    await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
    }, state);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should execute tools and continue when toolCalls present', async () => {
    const mocks = createMockProviders();
    mocks.toolProvider.execute.mockResolvedValue([
      { toolCallId: 'tc1', toolName: 'echo', output: 'result' },
    ]);

    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('', [
      { toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } },
    ]));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are test',
      availableTools: {},
    }, state);

    expect(mocks.toolProvider.execute).toHaveBeenCalledWith([
      { toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } },
    ]);
    expect(result.completed).toBe(false);
    expect(result.shouldContinue).toBe(true);
    expect(state.conversation.some(m => (m as any).role === 'tool')).toBe(true);
  });

  it('should use memoryProvider to build context', async () => {
    const mocks = createMockProviders();
    mocks.memoryProvider.buildContext.mockResolvedValue({
      systemPrompt: 'Custom system prompt',
      messages: [{ role: 'user', content: 'previous' }],
    });

    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('OK'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'ignored',
      availableTools: {},
    }, state);

    expect(mocks.memoryProvider.buildContext).toHaveBeenCalledWith(state);
    expect(ai.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'Custom system prompt',
      }),
    );
  });

  it('should call compressor when shouldCompress returns true', async () => {
    const mocks = createMockProviders();
    mocks.compressor.shouldCompress.mockReturnValue(true);
    mocks.compressor.compress.mockResolvedValue([
      { role: 'user', content: 'compressed' },
    ]);

    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('OK'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
    }, state);

    expect(mocks.compressor.shouldCompress).toHaveBeenCalledWith(state);
    expect(mocks.compressor.compress).toHaveBeenCalled();
  });
});
