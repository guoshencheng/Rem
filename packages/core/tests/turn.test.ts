import { describe, it, expect, vi } from 'vitest';
import type { ModelMessage } from '../src/types.js';
import { ReactTurnRunner } from '../src/turn.js';
import { IterationBudget } from '../src/budget.js';
import type { LoopStrategy, LoopContext, LoopResult, TurnHooks } from '../src/loop-strategy.js';
import { AgentStreamController } from '../src/stream/agent-stream.js';

const createMockLoop = (result: Partial<LoopResult>): LoopStrategy => {
  const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, _step: number) => {
    const resolved: LoopResult = {
      content: 'done',
      newMessages: [],
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
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
      
      budget: new IterationBudget({ maxTurns: 5 }),
    }, { onMessageAdded: vi.fn(), onToolCallRecorded: vi.fn() }, new AgentStreamController());

    expect(result.content).toBe('done');
    expect(result.newMessages).toHaveLength(1); // assistant only
    expect(conversation).toHaveLength(1);
    expect(loop.iterate).toHaveBeenCalled();
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
      
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 1,
    }, { onMessageAdded, onToolCallRecorded }, new AgentStreamController());

    expect(onMessageAdded).toHaveBeenCalledTimes(2);
  });

  it('should pass abort signal to loop strategy', async () => {
    const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, _step: number) => {
      const resolved: LoopResult = {
        content: 'aborted',
        newMessages: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }, outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined } },
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
      
      budget: new IterationBudget({ maxTurns: 5 }),
      signal: controller.signal,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, new AgentStreamController())).rejects.toThrow('Turn aborted');
  });

  it('should propagate usage from LoopResult to TurnResult', async () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };
    const loop = createMockLoop({
      usage,
      newMessages: [{ role: 'tool', content: 'result' } as ModelMessage],
    });
    const runner = new ReactTurnRunner(loop);

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [{ role: 'user', content: 'hi' } as ModelMessage],
      systemPrompt: '',
      
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 1,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, new AgentStreamController());

    expect(result.usage).toEqual(usage);
  });

  it('loops until no newMessages and emits step boundaries', async () => {
    let callIndex = 0;
    const iterateMock = vi.fn().mockImplementation(async (_ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, step: number) => {
      callIndex++;
      const hasMore = callIndex !== 2;
      const toolMsg: ModelMessage = { role: 'tool', toolCallId: `tc${step}`, toolName: 'calc', content: '2' } as ModelMessage;
      const resolved: LoopResult = {
        content: hasMore ? '' : 'done',
        newMessages: hasMore ? [toolMsg] : [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }, outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined } },
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
      
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 50,
    }, {
      onMessageAdded: (msg) => added.push(msg),
      onToolCallRecorded: vi.fn(),
    }, controller);

    expect(result.content).toBe('done');
    expect(added.length).toBe(2); // assistant + tool

    controller.finish({ content: result.content, completed: true });
    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'step-start' && c.step === 1)).toBe(true);
    expect(chunks.some(c => c.type === 'step-finish' && c.step === 1)).toBe(true);
    expect(chunks.some(c => c.type === 'step-start' && c.step === 2)).toBe(true);
    expect(chunks.some(c => c.type === 'step-finish' && c.step === 2)).toBe(true);
  });

  it('includes the final assistant message when loop creates one in a later step', async () => {
    const iterateMock = vi.fn().mockImplementation(async (ctx: LoopContext, hooks: TurnHooks, _controller: AgentStreamController, step: number) => {
      const hasMore = step === 1;
      if (hasMore) {
        const toolMsg: ModelMessage = { id: 't1', role: 'tool', content: '2' };
        hooks.onMessageAdded(toolMsg);
        return {
          content: '',
          newMessages: [toolMsg],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }, outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined } },
        };
      }
      const finalAssistant: ModelMessage = { id: 'a2', role: 'assistant', content: [{ type: 'text', text: 'Done' }] };
      ctx.state.addMessage(finalAssistant);
      return {
        content: 'Done',
        newMessages: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }, outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined } },
      };
    });
    const loop: LoopStrategy = { iterate: iterateMock };
    const runner = new ReactTurnRunner(loop);

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [],
      systemPrompt: '',
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 50,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, new AgentStreamController());

    expect(result.content).toBe('Done');
    expect(result.newMessages.some(m => m.id === 'a2' && m.role === 'assistant')).toBe(true);
  });

  it('emits message-start for the first assistant message', async () => {
    const loop = createMockLoop({});
    const runner = new ReactTurnRunner(loop);
    const controller = new AgentStreamController();

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [],
      systemPrompt: '',
      budget: new IterationBudget({ maxTurns: 5 }),
    }, { onMessageAdded: vi.fn(), onToolCallRecorded: vi.fn() }, controller);

    controller.finish({ content: result.content, completed: true });
    const chunks = [];
    for await (const chunk of controller.stream.fullStream) {
      chunks.push(chunk);
    }

    const messageStarts = chunks.filter(c => c.type === 'message-start');
    expect(messageStarts).toHaveLength(1);
    const ms = messageStarts[0] as Extract<import('../src/types.js').AgentStreamChunk, { type: 'message-start' }>;
    expect(ms.messageId).toBeDefined();
    expect(typeof ms.messageId).toBe('string');
  });

  it('respects maxSteps', async () => {
    const iterateMock = vi.fn().mockImplementation(async () => ({
      content: '',
      newMessages: [{ role: 'tool', content: 'x' } as ModelMessage],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }, outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined } },
    }));
    const loop: LoopStrategy = { iterate: iterateMock };
    const runner = new ReactTurnRunner(loop);
    const controller = new AgentStreamController();

    const result = await runner.run({
      input: { content: 'hi' },
      conversation: [],
      systemPrompt: '',
      budget: new IterationBudget({ maxTurns: 5 }),
      maxSteps: 1,
    }, {
      onMessageAdded: vi.fn(),
      onToolCallRecorded: vi.fn(),
    }, controller);

    expect(result.content).toBe('');
    expect(iterateMock).toHaveBeenCalledTimes(1);
  });

  it('passes sessionId into loop context', async () => {
    const loop = createMockLoop({});
    const runner = new ReactTurnRunner(loop);

    await runner.run({
      input: { content: 'hi' },
      conversation: [],
      systemPrompt: '',
      budget: new IterationBudget({ maxTurns: 5 }),
      workspaceRoot: '/tmp',
      sessionId: 'session-abc',
    }, { onMessageAdded: vi.fn(), onToolCallRecorded: vi.fn() }, new AgentStreamController());

    expect(loop.iterate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-abc' }),
      expect.anything(),
      expect.anything(),
      expect.any(Number),
    );
  });
});
