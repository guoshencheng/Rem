import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../../../../src/plugins/loop/react/index.js';
import type { LoopContext } from '../../../../src/sdk/loop-strategy.js';
import { AgentLiveState } from '../../../../src/state.js';

describe('ReactLoop', () => {
  it('stops when reason returns no tool calls', async () => {
    const reason = vi.fn(async () => ({
      text: 'hello',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    }));
    const execute = vi.fn();

    const session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const liveState = new AgentLiveState();

    const loop = new ReactLoop();
    const ctx: LoopContext = {
      session,
      liveState,
      system: 'You are Rem.',
      messages: [],
      reason,
      execute: execute as any,
      emit: () => {},
      provider: 'openai', // still needed for backward compat in some paths
      modelConfig: { model: 'gpt-4o-mini', apiKey: 'test' },
    } as any;

    const result = await loop.run(ctx);

    expect(result.content).toBe('hello');
    expect(reason).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('calls execute when reason returns tool calls', async () => {
    const reason = vi.fn(async () => ({
      text: '',
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      finishReason: 'tool_calls',
    }));
    const execute = vi.fn(async () => [
      { toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' },
    ]);

    const session = {
      sessionId: 's1',
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const liveState = new AgentLiveState();
    const loop = new ReactLoop();
    const ctx: LoopContext = {
      session,
      liveState,
      system: 'You are Rem.',
      messages: [],
      reason,
      execute,
      emit: () => {},
      provider: 'openai',
      modelConfig: { model: 'gpt-4o-mini', apiKey: 'test' },
    } as any;

    await loop.run(ctx);

    expect(execute).toHaveBeenCalledWith([
      { toolCallId: 'tc-1', toolName: 'echo', input: {} },
    ]);
    expect(session.conversation.length).toBeGreaterThan(0);
  });
});
