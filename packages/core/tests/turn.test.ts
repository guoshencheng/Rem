import { describe, it, expect, vi } from 'vitest';
import type { ModelMessage, LanguageModel } from 'ai';
import { ReactTurnRunner } from '../src/turn.js';
import { IterationBudget } from '../src/budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from '../src/loop-strategy.js';

const createMockLoop = (result: Partial<LoopResult>): LoopStrategy => {
  const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks) => {
    const resolved = {
      finalOutput: { content: 'done', completed: true },
      newMessages: [{ role: 'assistant', content: 'done' } as ModelMessage],
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      iterations: 1,
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
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    });

    expect(result.output.content).toBe('done');
    expect(result.newMessages).toHaveLength(1);
    expect(conversation).toHaveLength(1);
    expect(loop.iterate).toHaveBeenCalled();
  });

  it('should pass hooks to loop and track added messages', async () => {
    const loop = createMockLoop({
      newMessages: [
        { role: 'tool', content: 'result' } as ModelMessage,
        { role: 'assistant', content: 'done' } as ModelMessage,
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
    }, { onMessageAdded, onToolCallRecorded });

    expect(onMessageAdded).toHaveBeenCalledTimes(2);
  });

  it('should pass abort signal to loop strategy', async () => {
    const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks) => {
      const resolved = {
        finalOutput: { content: 'aborted', completed: true },
        newMessages: [{ role: 'assistant', content: 'aborted' } as ModelMessage],
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        iterations: 1,
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

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as ModelMessage],
      systemPrompt: '',
      model: {} as LanguageModel,
      budget: new IterationBudget({ maxTurns: 5 }),
      signal: controller.signal,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    });

    expect(result.output.content).toBe('aborted');
    const callCtx = iterateMock.mock.calls[0][0];
    expect(callCtx.signal).toBe(controller.signal);
  });

  it('should propagate toolCalls and usage from LoopResult to TurnResult', async () => {
    const toolCalls = [{ toolCallId: 'tc1', toolName: 'testTool', input: { key: 'value' } }];
    const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
    const loop = createMockLoop({
      toolCalls,
      usage,
      newMessages: [{ role: 'assistant', content: 'done' } as ModelMessage],
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
    });

    expect(result.toolCalls).toEqual(toolCalls);
    expect(result.usage).toEqual(usage);
  });
});
