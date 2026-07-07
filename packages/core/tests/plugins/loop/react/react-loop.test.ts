import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../../../../src/plugins/loop/react/index.js';
import type { LoopContext } from '../../../../src/sdk/loop-strategy.js';
import { AgentLiveState } from '../../../../src/state.js';

describe('ReactLoop', () => {
  it('stops when reason returns no tool calls', async () => {
    const reasonProvider = {
      reason: vi.fn(async (_params, _ctx, emit) => {
        await emit({ type: 'text-delta', step: 1, text: 'hello' });
        return {
          text: 'hello',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }),
    };
    const executeProvider = { execute: vi.fn() };

    const session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const liveState = new AgentLiveState();
    const chunks: unknown[] = [];

    const loop = new ReactLoop({ reasonProvider, executeProvider });
    const ctx: LoopContext = {
      session,
      liveState,
      system: 'You are Rem.',
      messages: [],
      emit: (c) => { chunks.push(c); },
      provider: 'openai',
      modelConfig: { model: 'gpt-4o-mini', apiKey: 'test' },
    };

    const result = await loop.run(ctx);

    expect(result.content).toBe('hello');
    expect(reasonProvider.reason).toHaveBeenCalledTimes(1);
    expect(executeProvider.execute).not.toHaveBeenCalled();
  });

  it('calls execute when reason returns tool calls', async () => {
    const reasonProvider = {
      reason: vi.fn(async (_params, _ctx, emit) => {
        await emit({ type: 'tool-call', step: 1, toolCallId: 'tc-1', toolName: 'echo', input: {} });
        return {
          text: '',
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
          usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
          finishReason: 'tool_calls',
        };
      }),
    };
    const executeProvider = {
      execute: vi.fn(async (_calls, _ctx, emit) => {
        await emit({ type: 'tool-result', step: 1, toolCallId: 'tc-1', output: 'echoed' });
        return [{ toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' }];
      }),
    };

    const session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const liveState = new AgentLiveState();
    const loop = new ReactLoop({ reasonProvider, executeProvider });
    const ctx: LoopContext = {
      session,
      liveState,
      system: 'You are Rem.',
      messages: [],
      emit: () => {},
      provider: 'openai',
      modelConfig: { model: 'gpt-4o-mini', apiKey: 'test' },
    };

    await loop.run(ctx);

    expect(executeProvider.execute).toHaveBeenCalledWith(
      [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
      expect.any(Object),
      expect.any(Function),
    );
    expect(session.conversation.length).toBeGreaterThan(0);
  });
});
