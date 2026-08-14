import { describe, expect, it } from 'vitest';
import { MAX_PENDING_RUN_SIGNALS, RunSignalHub } from '../src/runtime-events/run-signal-hub.js';

describe('RunSignalHub', () => {
  it('closes a slow subscriber instead of growing its queue without a bound', async () => {
    const hub = new RunSignalHub();
    const subscription = hub.subscribe('run-1');
    for (let index = 0; index < MAX_PENDING_RUN_SIGNALS + 1; index += 1) {
      hub.publish({ runId: 'run-1', type: 'assistant.text.delta', data: { index }, occurredAt: new Date(0) });
    }

    await expect(subscription[Symbol.asyncIterator]().next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('does not close other run subscribers when one overflows', async () => {
    const hub = new RunSignalHub();
    const slow = hub.subscribe('run-1');
    const healthy = hub.subscribe('run-1');
    const iterator = healthy[Symbol.asyncIterator]();
    for (let index = 0; index < MAX_PENDING_RUN_SIGNALS + 1; index += 1) {
      hub.publish({ runId: 'run-1', type: 'assistant.text.delta', data: { index }, occurredAt: new Date(0) });
      await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { data: { index } } });
    }

    await expect(slow[Symbol.asyncIterator]().next()).resolves.toEqual({ done: true, value: undefined });
    iterator.return?.();
  });
});
