import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../src/loop.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';

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
  beforeEach(() => {
    clearProviders();
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello!' };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });
  });

  it('should execute a simple turn without tools', async () => {
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
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(result.output.content).toBe('Hello!');
    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  it('should emit turn events', async () => {
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
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should execute tools and continue when toolCalls present', async () => {
    registerProvider('mock-tools', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } };
        yield { type: 'usage', inputTokens: 5, outputTokens: 5, totalTokens: 10 };
      },
    });

    const mocks = createMockProviders();
    mocks.toolProvider.execute.mockResolvedValue([
      { toolCallId: 'tc1', toolName: 'echo', output: 'result' },
    ]);

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are test',
      availableTools: {},
      provider: 'mock-tools',
      providerConfig: { apiKey: 'key', model: 'model' },
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

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'ignored',
      availableTools: {},
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(mocks.memoryProvider.buildContext).toHaveBeenCalledWith(state);
  });

  it('should call compressor when shouldCompress returns true', async () => {
    const mocks = createMockProviders();
    mocks.compressor.shouldCompress.mockReturnValue(true);
    mocks.compressor.compress.mockResolvedValue([
      { role: 'user', content: 'compressed' },
    ]);

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor);

    await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
      provider: 'mock',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, state);

    expect(mocks.compressor.shouldCompress).toHaveBeenCalledWith(state);
    expect(mocks.compressor.compress).toHaveBeenCalled();
  });
});
