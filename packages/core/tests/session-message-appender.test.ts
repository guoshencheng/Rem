import { describe, expect, it } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import type { SessionTreeEntry } from '../src/session/tree/types.js';
import { SessionMessageAppender } from '../src/session/messages/appender.js';

const message = { role: 'user', content: 'hello', timestamp: 1 } as Message;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('SessionMessageAppender', () => {
  it('serializes one session while allowing other sessions to proceed', async () => {
    const gate = deferred();
    const calls: string[] = [];
    const entries: SessionTreeEntry[] = [];
    const appender = new SessionMessageAppender({
      async getActiveLeafId(sessionId) {
        calls.push(`leaf:${sessionId}`);
        return entries.findLast((entry) => entry.sessionId === sessionId)?.id ?? null;
      },
      async appendEntry(entry) {
        calls.push(`append:${entry.sessionId}:${(entry.payload as { messageId: string }).messageId}`);
        if ((entry.payload as { messageId: string }).messageId === 'first') await gate.promise;
        entries.push(entry);
      },
    });

    const first = appender.append({ sessionId: 'same', message, messageId: 'first' });
    const second = appender.append({ sessionId: 'same', message, messageId: 'second' });
    const other = appender.append({ sessionId: 'other', message, messageId: 'other' });
    await other;
    expect(calls).not.toContain('append:same:second');
    expect(calls).toContain('append:other:other');
    gate.resolve();
    await Promise.all([first, second]);
    expect(entries.filter((entry) => entry.sessionId === 'same')[1]?.parentId)
      .toBe(entries.filter((entry) => entry.sessionId === 'same')[0]?.id);
  });

  it('continues after a failed append', async () => {
    let attempts = 0;
    const appender = new SessionMessageAppender({
      async getActiveLeafId() { return null; },
      async appendEntry() {
        attempts += 1;
        if (attempts === 1) throw new Error('write failed');
      },
    });
    await expect(appender.append({ sessionId: 's', message, messageId: 'bad' })).rejects.toThrow('write failed');
    await expect(appender.append({ sessionId: 's', message, messageId: 'good' })).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });
});
