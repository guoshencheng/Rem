import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactLoop } from '../src/loop-strategy.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import { SimpleErrorHandler } from '../src/defaults/simple-error-handler.js';
import { registerProvider, clearProviders } from '../src/llm/api-registry.js';
import type { ErrorHandler } from '../src/sdk/error-handler.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

const createMockProviders = () => ({
  toolProvider: {
    register: vi.fn(),
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
  errorHandler: new SimpleErrorHandler(),
});

const createMockHooks = () => ({
  onMessageAdded: vi.fn(),
  onToolCallRecorded: vi.fn(),
});

describe('ReactLoop', () => {
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

  it('should iterate a simple turn without tools', async () => {
    const mocks = createMockProviders();
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    const hooks = createMockHooks();

    const result = await loop.iterate({
      state,
      systemPrompt: 'You are helpful',
      model: createMockModel(),
      budget: state.budget,
    }, hooks, new AgentStreamController(), 1);

    expect(result.finalOutput.content).toBe('Hello!');
    expect(result.newMessages.some(m => m.role === 'assistant')).toBe(false);
    expect(hooks.onMessageAdded).not.toHaveBeenCalled();
    expect(state.conversation.some(m => m.role === 'assistant')).toBe(true);
  });

  it('should emit turn events', async () => {
    const mocks = createMockProviders();
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();
    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    await loop.iterate({ state, systemPrompt: '', model: createMockModel(), budget: state.budget }, createMockHooks(), new AgentStreamController(), 1);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should execute tools and record them', async () => {
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

    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    const hooks = createMockHooks();

    const result = await loop.iterate({
      state,
      systemPrompt: 'You are test',
      model: createMockModel(),
      budget: state.budget,
      provider: 'mock-tools',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, hooks, new AgentStreamController(), 1);

    expect(mocks.toolProvider.execute).toHaveBeenCalledWith([
      { toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } },
    ]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.newMessages.filter(m => m.role === 'tool')).toHaveLength(1);
    expect(result.newMessages.filter(m => m.role === 'assistant')).toHaveLength(0);
    expect(hooks.onToolCallRecorded).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tc1',
      name: 'echo',
    }));
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

    const mocks = createMockProviders();
    const errorHandler: ErrorHandler = {
      classify: vi.fn().mockReturnValue('api_error'),
      isRetryable: vi.fn().mockReturnValue(true),
      getRetryInstruction: vi.fn(),
    };
    mocks.errorHandler = errorHandler;

    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);

    const result = await loop.iterate({
      state,
      systemPrompt: '',
      model: createMockModel(),
      budget: state.budget,
      provider: 'retryable',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, createMockHooks(), new AgentStreamController(), 1);

    expect(result.finalOutput.content).toBe('Recovered!');
    expect(callCount).toBe(2);
  });

  it('emits raw text chunks without partId', async () => {
    const mocks = createMockProviders();
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    const controller = new AgentStreamController();

    await loop.iterate({ state, systemPrompt: '', model: createMockModel(), budget: state.budget }, createMockHooks(), controller, 1);
    controller.finish({ content: 'Hello!', completed: true });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'text-start' && c.partId)).toBe(true);
    expect(chunks.some(c => c.type === 'text-delta' && c.text === 'Hello!')).toBe(true);
    expect(chunks.some(c => c.type === 'text-finish')).toBe(true);
  });

  it('emits tool-result boundaries through controller', async () => {
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

    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'assistant', content: [] });
    const events = new EventBus();
    const loop = new ReactLoop(createMockModel(), events, mocks.toolProvider, mocks.memoryProvider, mocks.compressor, mocks.errorHandler);
    const controller = new AgentStreamController();

    await loop.iterate({
      state,
      systemPrompt: 'You are test',
      model: createMockModel(),
      budget: state.budget,
      provider: 'mock-tools',
      providerConfig: { apiKey: 'key', model: 'model' },
    }, createMockHooks(), controller, 1);
    controller.finish({ content: '', completed: false });

    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'tool-result-start' && c.partId === 'tc1')).toBe(true);
    expect(chunks.some(c => c.type === 'tool-result' && c.output === 'result')).toBe(true);
    expect(chunks.some(c => c.type === 'tool-result-finish')).toBe(true);
  });
});
