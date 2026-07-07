import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../../../../src/plugins/loop/react/index.js';
import type { LoopContext } from '../../../../src/sdk/loop-strategy.js';
import { AgentLiveState } from '../../../../src/state.js';

describe('ReactLoop', () => {
  it('stops when reason returns no tool calls', async () => {
    const reason = vi.fn(async () => ({
      text: 'hello', toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    }));
    const execute = vi.fn();
    const msgs: any[] = [];
    const liveState = new AgentLiveState();

    const loop = new ReactLoop();
    const ctx = {
      liveState, system: 'You are Rem.', messages: msgs,
      addMessage: () => { const m: any = { id: 'test-' + msgs.length, role: 'assistant', content: [] }; msgs.push(m); return m; },
      reason, execute: execute as any, emit: () => {},
    } as any;

    const result = await loop.run(ctx);

    expect(result.content).toBe('hello');
    expect(reason).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('calls execute when reason returns tool calls', async () => {
    const reason = vi.fn(async () => ({
      text: '', toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      finishReason: 'tool_calls',
    }));
    const execute = vi.fn(async () => [
      { toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' },
    ]);
    const msgs: any[] = [];
    const liveState = new AgentLiveState();
    const loop = new ReactLoop();
    const ctx = {
      liveState, system: 'You are Rem.', messages: msgs,
      addMessage: () => { const m: any = { id: 'test-' + msgs.length, role: 'assistant', content: [] }; msgs.push(m); return m; },
      reason, execute, emit: () => {},
    } as any;

    await loop.run(ctx);

    expect(execute).toHaveBeenCalledWith([
      { toolCallId: 'tc-1', toolName: 'echo', input: {} },
    ]);
    expect(msgs.length).toBeGreaterThan(0);
  });
});
