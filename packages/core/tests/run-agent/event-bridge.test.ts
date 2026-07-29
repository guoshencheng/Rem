import { describe, it, expect } from 'vitest';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import { createEventBridge } from '../../src/run-agent/event-bridge.js';
import { AgentEventStreamController } from '../../src/stream/agent-event-stream.js';
import type { AgentStreamEvent } from '../../src/types.js';

const usage: Usage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text: string): AssistantMessage => ({
  role: 'assistant', content: [{ type: 'text', text }], api: 'faux', provider: 'faux', model: 'faux-1',
  usage, stopReason: 'stop', timestamp: 1,
});

const setup = () => {
  const controller = new AgentEventStreamController();
  const events: AgentStreamEvent[] = [];
  const orig = controller.emit.bind(controller);
  controller.emit = (e: AgentStreamEvent) => { events.push(e); orig(e); };
  const bridge = createEventBridge({ controller });
  return { events, bridge };
};

describe('createEventBridge', () => {
  it('maps turn/message lifecycle to step/message meta events', () => {
    const { events, bridge } = setup();
    bridge.listener({ type: 'turn_start' });
    bridge.listener({ type: 'message_start', message: assistant('hi') });
    expect(events[0]).toEqual({ type: 'step-start', step: 1 });
    expect(events[1].type).toBe('message-start');
    expect((events[1] as { messageId: string }).messageId).toBeTruthy();
  });

  it('passes assistantMessageEvent through on message_update', () => {
    const { events, bridge } = setup();
    const partial = assistant('h');
    const delta = { type: 'text_delta' as const, contentIndex: 0, delta: 'h', partial } as never;
    bridge.listener({ type: 'message_update', message: partial, assistantMessageEvent: delta });
    expect(events[0]).toBe(delta);
  });

  it('maps tool_execution_end to tool-result and accumulates usage on turn_end', () => {
    const { events, bridge } = setup();
    bridge.listener({ type: 'turn_start' });
    bridge.listener({ type: 'message_start', message: assistant('') });
    bridge.listener({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'echo', result: { content: [{ type: 'text', text: 'out' }] }, isError: false });
    bridge.listener({ type: 'turn_end', message: assistant('done'), toolResults: [] });
    expect(events.find((e) => e.type === 'tool-result')).toEqual({ type: 'tool-result', toolCallId: 'tc1', toolName: 'echo', output: 'out', error: undefined });
    expect(events[events.length - 1]).toEqual({ type: 'step-finish', step: 1 });
    expect(bridge.getTotalUsage().totalTokens).toBe(3);
    expect(bridge.getLastAssistantMessage()?.stopReason).toBe('stop');
    expect(bridge.getCurrentMessageId()).toBeTruthy();
    expect(bridge.idOf(assistant('x'))).toBeUndefined();
  });

  it('marks tool errors in tool-result', () => {
    const { events, bridge } = setup();
    bridge.listener({ type: 'tool_execution_end', toolCallId: 'tc1', toolName: 'echo', result: { content: [{ type: 'text', text: 'bad' }] }, isError: true });
    expect(events[0]).toEqual({ type: 'tool-result', toolCallId: 'tc1', toolName: 'echo', output: 'bad', error: 'bad' });
  });

  it('resolves the streaming messageId for the final assistant message object', () => {
    const { bridge, events } = setup();
    bridge.listener({ type: 'message_start', message: assistant('partial') });
    const messageId = (events[0] as { messageId: string }).messageId;
    const finalMessage = assistant('full');
    bridge.listener({ type: 'message_end', message: finalMessage });
    expect(bridge.idOf(finalMessage)).toBe(messageId);
  });
});
