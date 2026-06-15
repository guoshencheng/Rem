import { describe, it, expect, vi } from 'vitest';
import type { ModelMessage, LanguageModel } from 'ai';
import { ReactTurnRunner } from '../src/turn.js';
import { IterationBudget } from '../src/budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from '../src/loop-strategy.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';

const createMockLoop = (result: Partial<LoopResult>): LoopStrategy => {
  const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, _step: number) => {
    const resolved = {
      finalOutput: { content: 'done', completed: true },
      newMessages: [{ role: 'tool', content: 'result' } as ModelMessage],
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      ...result,
    };
    for (const msg of resolved.newMessages) {
      hooks.onMessageAdded(msg);
    }
    return resolved;
  });
  return { iterate: iterateMock };
};

describe('ReactTurnRunner', () => {
  it('should run turn without mutating caller conversation', async () => {
    const loop = createMockLoop({});
    const runner = new ReactTurnRunner(loop);
    const conversation = [{ role: 'user', content: 'hi' } as ModelMessage];

    const result = await runner.run({
      input: { content: 'hi' },
      conversation,
      systemPrompt: 'You are helpful',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
    }, { onMessageAdded: vi.fn(), onToolCallRecorded: vi.fn() }, new AgentStreamController());

    expect(result.output.content).toBe('done');
    expect(result.newMessages).toHaveLength(2); // assistant + tool
    expect(conversation).toHaveLength(1);
    expect(loop.iterate).toHaveBeenCalled();
    expect(result.steps).toBe(1);
  });

  it('should pass hooks to loop and track added messages', async () => {
    const loop = createMockLoop({
      newMessages: [
        { role: 'tool', content: 'result' } as ModelMessage,
      ],
    });
    const runner = new ReactTurnRunner(loop);
    const onMessageAdded = vi.fn();
    const onToolCallRecorded = vi.fn();

    await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as ModelMessage],
      systemPrompt: '',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
    }, { onMessageAdded, onToolCallRecorded }, new AgentStreamController());

    expect(onMessageAdded).toHaveBeenCalledTimes(2);
  });

  it('should pass abort signal to loop strategy', async () => {
    const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, _step: number) => {
      const resolved = {
        finalOutput: { content: 'aborted', completed: true },
        newMessages: [],
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
      for (const msg of resolved.newMessages) {
        hooks.onMessageAdded(msg);
      }
      return resolved;
    });
    const loop: LoopStrategy = { iterate: iterateMock };
    const runner = new ReactTurnRunner(loop);
    const controller = new AbortController();
    controller.abort();

    await expect(runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as ModelMessage],
      systemPrompt: '',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
      signal: controller.signal,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, new AgentStreamController())).rejects.toThrow('Turn aborted');
  });

  it('should propagate toolCalls and usage from LoopResult to TurnResult', async () => {
    const toolCalls = [{ toolCallId: 'tc1', toolName: 'testTool', input: { key: 'value' } }];
    const usage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };
    const loop = createMockLoop({
      toolCalls,
      usage,
      newMessages: [{ role: 'tool', content: 'result' } as ModelMessage],
    });
    const runner = new ReactTurnRunner(loop);

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as ModelMessage],
      systemPrompt: '',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, new AgentStreamController());

    expect(result.toolCalls).toEqual(toolCalls);
    expect(result.usage).toEqual(usage);
  });

  it('loops until completed and emits step boundaries', async () => {
    let callIndex = 0;
    const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, step: number) => {
      callIndex++;
      const completed = callIndex === 2;
      const toolMsg: ModelMessage = { role: 'tool', toolCallId: `tc${step}`, toolName: 'calc', content: '2' } as unknown as ModelMessage;
      const resolved: LoopResult = {
        finalOutput: { content: completed ? 'done' : '', completed },
        newMessages: completed ? [] : [toolMsg],
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
      for (const msg of resolved.newMessages) {
        hooks.onMessageAdded(msg);
      }
      return resolved;
    });
    const loop: LoopStrategy = { iterate: iterateMock };
    const runner = new ReactTurnRunner(loop);
    const controller = new AgentStreamController();
    const added: ModelMessage[] = [];

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [],
      systemPrompt: '',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 50,
    }, {
      onMessageAdded: (msg) => added.push(msg),
      onToolCallRecorded: vi.fn(),
    }, controller);

    expect(result.output.completed).toBe(true);
    expect(result.steps).toBe(2);
    expect(added.length).toBe(2); // assistant + tool

    controller.finish(result.output);
    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'step-start' && c.step === 1)).toBe(true);
    expect(chunks.some(c => c.type === 'step-finish' && c.step === 1)).toBe(true);
    expect(chunks.some(c => c.type === 'step-start' && c.step === 2)).toBe(true);
    expect(chunks.some(c => c.type === 'step-finish' && c.step === 2)).toBe(true);
  });

  it('respects maxSteps', async () => {
    const iterateMock = vi.fn().mockImplementation(async () => ({
      finalOutput: { content: '', completed: false },
      newMessages: [],
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }));
    const loop: LoopStrategy = { iterate: iterateMock };
    const runner = new ReactTurnRunner(loop);
    const controller = new AgentStreamController();

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [],
      systemPrompt: '',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 1,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, controller);

    expect(result.steps).toBe(1);
    expect(result.output.completed).toBe(false);
    expect(iterateMock).toHaveBeenCalledTimes(1);
  });
});
