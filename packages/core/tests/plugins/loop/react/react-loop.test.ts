import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../../../../src/plugins/loop/react/index.js';
import { AgentLiveState } from '../../../../src/state.js';

describe('ReactLoop', () => {
  it('stops when reason returns no tool calls', async () => {
    const msgs: any[] = [];
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const m: any = { id: 'a', role: 'assistant', content: [] }; msgs.push(m); return m; },
      appendContent: () => {},
      reason: vi.fn(async () => ({
        text: 'hello', toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      })),
      execute: vi.fn(),
      emit: () => {},
    } as any;

    const loop = new ReactLoop();
    const result = await loop.run(ctx);

    expect(result.content).toBe('hello');
    expect(ctx.reason).toHaveBeenCalledTimes(1);
    expect(ctx.execute).not.toHaveBeenCalled();
  });

  it('calls execute when reason returns tool calls', async () => {
    const msgs: any[] = [];
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const m: any = { id: 'a', role: 'assistant', content: [] }; msgs.push(m); return m; },
      appendContent: () => {},
      reason: vi.fn(async () => ({
        text: '', toolCalls: [{ toolCallId: 'tc-1', toolName: 'echo', input: {} }],
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
        finishReason: 'tool_calls',
      })),
      execute: vi.fn(async () => [{ toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' }]),
      emit: () => {},
    } as any;

    const loop = new ReactLoop();
    await loop.run(ctx);

    expect(ctx.execute).toHaveBeenCalledWith([
      { toolCallId: 'tc-1', toolName: 'echo', input: {} },
    ]);
    expect(msgs.length).toBeGreaterThan(0);
  });
});
