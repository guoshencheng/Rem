import { describe, expect, it } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import {
  MessagePayloadError,
  normalizeMessagePayload,
  validateMessagePayload,
} from '../src/session/messages/index.js';

const userMessage = { role: 'user', content: 'hello', timestamp: 1 } as Message;
const assistantMessage = { role: 'assistant', content: [], timestamp: 2 } as Message;
const toolMessage = { role: 'toolResult', content: [], timestamp: 3 } as Message;

describe('message payload', () => {
  it('normalizes legacy messages against the primary thread', () => {
    expect(normalizeMessagePayload({ message: userMessage, messageId: 'u1' }, 'primary')).toMatchObject({
      author: { type: 'user' }, scope: { type: 'session' },
    });
    expect(normalizeMessagePayload({ message: assistantMessage, messageId: 'a1' }, 'primary')).toMatchObject({
      author: { type: 'agent', agentThreadId: 'primary' }, scope: { type: 'session' },
    });
    expect(normalizeMessagePayload({ message: toolMessage, messageId: 't1' }, 'primary')).toMatchObject({
      author: { type: 'tool', agentThreadId: 'primary' },
      scope: { type: 'thread', agentThreadId: 'primary' },
    });
  });

  it('deduplicates mentions and rejects incomplete explicit metadata', () => {
    const payload = validateMessagePayload({
      message: userMessage, messageId: 'u1', mentions: ['a', 'a', 'b'],
    });
    expect(payload.mentions).toEqual(['a', 'b']);
    expect(() => validateMessagePayload({
      message: assistantMessage,
      messageId: 'a1',
      author: { type: 'agent', agentThreadId: '' },
    })).toThrow(MessagePayloadError);
  });

  it('rejects unknown legacy roles explicitly', () => {
    const unknown = { role: 'system', content: 'x', timestamp: 1 } as unknown as Message;
    expect(() => normalizeMessagePayload({ message: unknown, messageId: 'x' }, 'primary'))
      .toThrow('unsupported message role: system');
  });
});
