import { describe, it, expect, vi } from 'vitest';
import { ReactTurnRunner } from '../src/turn.js';
import { IterationBudget } from '../src/budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from '../src/loop-strategy.js';

const createMockLoop = (result: Partial<LoopResult>): LoopStrategy => ({
  iterate: vi.fn().mockResolvedValue({
    finalOutput: { content: 'done', completed: true },
    newMessages: [{ role: 'assistant', content: 'done' } as any],
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    iterations: 1,
    ...result,
  }),
});

describe('ReactTurnRunner', () => {
  it('should run turn without mutating caller conversation', async () => {
    const loop = createMockLoop({});
    const runner = new ReactTurnRunner(loop);
    const conversation = [{ role: 'user', content: 'hi' } as any];

    const result = await runner.run({
      input: { content: 'hi' },
      conversation,
      systemPrompt: 'You are helpful',
      model: {} as any,
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
        { role: 'tool', content: 'result' } as any,
        { role: 'assistant', content: 'done' } as any,
      ],
    });
    const runner = new ReactTurnRunner(loop);
    const onMessageAdded = vi.fn();
    const onToolCallRecorded = vi.fn();

    await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as any],
      systemPrompt: '',
      model: {} as any,
      budget: new IterationBudget({ maxTurns: 5 }),
    }, { onMessageAdded, onToolCallRecorded });

    expect(onMessageAdded).toHaveBeenCalledTimes(2);
  });

  it('should abort when signal is triggered', async () => {
    const loop: LoopStrategy = {
      iterate: vi.fn().mockImplementation(async (_ctx: LoopContext, _hooks: TurnHooks) => {
        return {
          finalOutput: { content: 'aborted', completed: true },
          newMessages: [{ role: 'assistant', content: 'aborted' } as any],
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          iterations: 1,
        };
      }),
    };
    const runner = new ReactTurnRunner(loop);
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as any],
      systemPrompt: '',
      model: {} as any,
      budget: new IterationBudget({ maxTurns: 5 }),
      signal: controller.signal,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    });

    expect(result.output.content).toBe('aborted');
    const callCtx = (loop.iterate as any).mock.calls[0][0];
    expect(callCtx.signal).toBe(controller.signal);
  });
});
