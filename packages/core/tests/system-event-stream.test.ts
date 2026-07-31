import { describe, expect, it } from 'vitest';
import { BroadcastBus } from '../src/agent/broadcast-bus.js';
import { streamSystemEvents } from '../src/system/event-stream.js';

describe('streamSystemEvents', () => {
  it('每个订阅者独立收取事件，abort 只结束自身', async () => {
    const bus = new BroadcastBus();
    const controller = new AbortController();
    const first = streamSystemEvents(bus, controller.signal)[Symbol.asyncIterator]();
    const second = streamSystemEvents(bus)[Symbol.asyncIterator]();
    const firstNext = first.next();
    const secondNext = second.next();
    bus.publish({ type: 'session-start', sessionId: 's-1', workspace: 'ws' });
    await expect(firstNext).resolves.toMatchObject({ value: { type: 'session-start' } });
    await expect(secondNext).resolves.toMatchObject({ value: { type: 'session-start' } });

    controller.abort();
    await expect(first.next()).resolves.toEqual({ done: true, value: undefined });
    const next = second.next();
    bus.publish({ type: 'session-end', sessionId: 's-1', workspace: 'ws' });
    await expect(next).resolves.toMatchObject({ value: { type: 'session-end' } });
    await second.return?.();
  });
});
