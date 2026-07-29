import { describe, it, expect, vi } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { createSessionWriter } from '../../src/run-agent/session-writer.js';
import type { Session } from '../../src/session.js';

const session: Session = {
  sessionId: 's1', conversation: [], currentTurn: 0,
  metadata: { schemaVersion: 2 }, createdAt: new Date(), updatedAt: new Date(),
};

describe('createSessionWriter', () => {
  it('persists messages on message_end with the bridged messageId', async () => {
    const appendMessage = vi.fn(async () => {});
    const writer = createSessionWriter({
      sessionProvider: { appendMessage } as never,
      session,
      idOf: () => 'mid-1',
    });
    const message: Message = { role: 'user', content: 'hi', timestamp: 1 };
    await writer({ type: 'message_end', message });
    expect(appendMessage).toHaveBeenCalledWith(session, message, 'mid-1');
  });

  it('generates an id when the message is unknown to the event bridge', async () => {
    const appendMessage = vi.fn(async () => {});
    const writer = createSessionWriter({
      sessionProvider: { appendMessage } as never,
      session,
      idOf: () => undefined,
    });
    await writer({ type: 'message_end', message: { role: 'user', content: 'hi', timestamp: 1 } });
    expect((appendMessage.mock.calls[0][2] as string).length).toBeGreaterThan(0);
  });

  it('ignores non message_end events', async () => {
    const appendMessage = vi.fn(async () => {});
    const writer = createSessionWriter({ sessionProvider: { appendMessage } as never, session, idOf: () => undefined });
    await writer({ type: 'turn_start' });
    expect(appendMessage).not.toHaveBeenCalled();
  });
});
