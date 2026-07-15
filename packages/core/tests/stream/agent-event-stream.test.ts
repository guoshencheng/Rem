import { describe, it, expect } from 'vitest';
import { AgentEventStreamController } from '../../src/stream/agent-event-stream.js';
import type { AssistantMessage } from '@earendil-works/pi-ai';

describe('AgentEventStreamController', () => {
  it('emits pi-ai text_delta events', async () => {
    const controller = new AgentEventStreamController();
    const events: unknown[] = [];
    controller.emit({ type: 'text_delta', contentIndex: 0, delta: 'hi', partial: {} as AssistantMessage });
    controller.finish(
      { content: 'hi', completed: true },
      {
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input: 0,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      } as AssistantMessage,
    );
    for await (const event of controller.stream.fullStream) {
      events.push(event);
    }
    expect(events.some((e) => (e as any).type === 'text_delta')).toBe(true);
    expect(await controller.stream.text).toBe('hi');
    expect((await controller.stream.usage).totalTokens).toBe(1);
  });

  it('resolves usage from final message', async () => {
    const controller = new AgentEventStreamController();
    controller.finish(
      { content: '', completed: true },
      {
        content: [],
        usage: {
          input: 2,
          output: 3,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      } as AssistantMessage,
    );
    const usage = await controller.stream.usage;
    expect(usage.input).toBe(2);
    expect(usage.output).toBe(3);
    expect(usage.totalTokens).toBe(5);
  });

  it('emits session-title and finish events', async () => {
    const controller = new AgentEventStreamController();
    controller.pushTitle('hello');
    controller.finish({ content: 'done', completed: true });
    const events: unknown[] = [];
    for await (const event of controller.stream.fullStream) {
      events.push(event);
    }
    expect(events.some((e) => (e as any).type === 'session-title' && (e as any).title === 'hello')).toBe(true);
    expect(events.some((e) => (e as any).type === 'finish')).toBe(true);
  });

  it('emits error event through fail without throwing', async () => {
    const controller = new AgentEventStreamController();
    controller.fail(new Error('boom'));
    const events: unknown[] = [];
    for await (const event of controller.stream.fullStream) {
      events.push(event);
    }
    expect(events.some((e) => (e as any).type === 'error')).toBe(true);
    const errorEvent = events.find((e) => (e as any).type === 'error') as any;
    expect(errorEvent.error.message).toBe('boom');
  });
});
