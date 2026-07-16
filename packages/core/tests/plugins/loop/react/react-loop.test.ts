import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from '../../../../src/plugins/loop/react/index.js';
import { AgentLiveState } from '../../../../src/state.js';
import type { AssistantMessageEventStream, AssistantMessage, TextContent, ToolCall } from '@earendil-works/pi-ai';

function createMockStream(
  events: AssistantMessageEvent[],
  finalMessage: AssistantMessage,
): AssistantMessageEventStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    result: vi.fn().mockResolvedValue(finalMessage),
  } as unknown as AssistantMessageEventStream;
}

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe('ReactLoop', () => {
  it('stops when stream returns no tool calls', async () => {
    const msgs: any[] = [];
    const stream = vi.fn().mockReturnValue(createMockStream(
      [{ type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as AssistantMessage }],
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' } as TextContent],
        usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 },
        stopReason: 'stop',
      } as AssistantMessage,
    ));
    const generate = vi.fn().mockResolvedValue({});
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const message: any = { role: 'assistant', content: [], timestamp: Date.now() }; msgs.push(message); return { messageId: 'a', message }; },
      appendContent: () => {},
      stream,
      generate,
      execute: vi.fn(),
      emit: () => {},
    } as any;

    const loop = new ReactLoop();
    const result = await loop.run(ctx);

    expect(result.content).toBe('hello');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.execute).not.toHaveBeenCalled();
  });

  it('calls execute when stream returns tool calls', async () => {
    const msgs: any[] = [];
    const toolCall: ToolCall = { type: 'toolCall', id: 'tc-1', name: 'echo', arguments: {} };
    const stream = vi.fn().mockReturnValue(createMockStream(
      [
        { type: 'toolcall_end', contentIndex: 0, toolCall, partial: {} as AssistantMessage },
      ],
      {
        role: 'assistant',
        content: [toolCall],
        usage: { ...emptyUsage, input: 2, output: 2, totalTokens: 4 },
        stopReason: 'toolUse',
      } as AssistantMessage,
    ));
    const generate = vi.fn().mockResolvedValue({});
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const message: any = { role: 'assistant', content: [], timestamp: Date.now() }; msgs.push(message); return { messageId: 'a', message }; },
      appendContent: () => {},
      stream,
      generate,
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

  it('accumulates usage across multiple steps', async () => {
    const msgs: any[] = [];
    const toolCall: ToolCall = { type: 'toolCall', id: 'tc-1', name: 'echo', arguments: {} };
    const stream = vi.fn()
      .mockReturnValueOnce(createMockStream(
        [{ type: 'toolcall_end', contentIndex: 0, toolCall, partial: {} as AssistantMessage }],
        {
          role: 'assistant',
          content: [toolCall],
          usage: { ...emptyUsage, input: 10, output: 5, totalTokens: 15 },
          stopReason: 'toolUse',
        } as AssistantMessage,
      ))
      .mockReturnValueOnce(createMockStream(
        [{ type: 'text_delta', contentIndex: 0, delta: 'step 2', partial: {} as AssistantMessage }],
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'step 2' } as TextContent],
          usage: { ...emptyUsage, input: 20, output: 10, totalTokens: 30 },
          stopReason: 'stop',
        } as AssistantMessage,
      ));
    const generate = vi.fn().mockResolvedValue({});
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const message: any = { role: 'assistant', content: [], timestamp: Date.now() }; msgs.push(message); return { messageId: 'a', message }; },
      appendContent: () => {},
      stream,
      generate,
      execute: vi.fn(async () => [{ toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' }]),
      emit: () => {},
    } as any;

    const loop = new ReactLoop();
    const result = await loop.run(ctx);

    expect(result.usage.input).toBe(30);
    expect(result.usage.output).toBe(15);
    expect(result.usage.totalTokens).toBe(45);
  });

  it('adjusts contentIndex across steps so events accumulate instead of overwrite', async () => {
    const msgs: any[] = [];
    const toolCall: ToolCall = { type: 'toolCall', id: 'tc-1', name: 'echo', arguments: {} };
    const stream = vi.fn()
      .mockReturnValueOnce(createMockStream(
        [
          { type: 'text_start', contentIndex: 0, partial: {} as AssistantMessage },
          { type: 'text_delta', contentIndex: 0, delta: 'step 1 ', partial: {} as AssistantMessage },
          { type: 'toolcall_end', contentIndex: 1, toolCall, partial: {} as AssistantMessage },
        ],
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'step 1 ' } as TextContent, toolCall],
          usage: { ...emptyUsage, input: 1, output: 1, totalTokens: 2 },
          stopReason: 'toolUse',
        } as AssistantMessage,
      ))
      .mockReturnValueOnce(createMockStream(
        [
          { type: 'text_start', contentIndex: 0, partial: {} as AssistantMessage },
          { type: 'text_delta', contentIndex: 0, delta: 'step 2', partial: {} as AssistantMessage },
        ],
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'step 2' } as TextContent],
          usage: { ...emptyUsage, input: 2, output: 2, totalTokens: 4 },
          stopReason: 'stop',
        } as AssistantMessage,
      ));
    const generate = vi.fn().mockResolvedValue({});
    const emitted: AssistantMessageEvent[] = [];
    const ctx = {
      liveState: new AgentLiveState(),
      system: 'You are Rem.',
      messages: msgs,
      addMessage: () => { const message: any = { role: 'assistant', content: [], timestamp: Date.now() }; msgs.push(message); return { messageId: 'a', message }; },
      appendContent: () => {},
      stream,
      generate,
      execute: vi.fn(async () => [{ toolCallId: 'tc-1', toolName: 'echo', output: 'echoed' }]),
      emit: (e: AssistantMessageEvent) => emitted.push(e),
    } as any;

    const loop = new ReactLoop();
    await loop.run(ctx);

    // Step 2 的 text_start 和 text_delta 的 contentIndex 应该从 2 开始（step1 贡献了 2 个 content block）
    const step2TextStart = emitted.find((e) => e.type === 'text_start' && e.contentIndex === 2);
    const step2TextDelta = emitted.find((e) => e.type === 'text_delta' && e.contentIndex === 2 && (e as { delta?: string }).delta === 'step 2');
    expect(step2TextStart).toBeDefined();
    expect(step2TextDelta).toBeDefined();
    // Step 1 的 contentIndex 不应被调整
    expect(emitted.find((e) => e.type === 'text_start' && e.contentIndex === 0)).toBeDefined();
    expect(emitted.find((e) => e.type === 'toolcall_end' && e.contentIndex === 1)).toBeDefined();
  });
});
