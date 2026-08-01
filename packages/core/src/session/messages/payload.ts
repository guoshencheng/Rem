import type { Message } from '@earendil-works/pi-ai';

export type MessageAuthor =
  | { type: 'user'; agentThreadId?: never }
  | { type: 'agent' | 'tool'; agentThreadId: string };

export type MessageScope =
  | { type: 'session'; agentThreadId?: never }
  | { type: 'thread'; agentThreadId: string };

export interface MessageEntryPayload {
  message: Message;
  messageId: string;
  author?: MessageAuthor;
  scope?: MessageScope;
  mentions?: string[];
  replyToMessageId?: string;
  rootUserMessageId?: string;
}

export interface NormalizedMessageEntryPayload extends MessageEntryPayload {
  author: MessageAuthor;
  scope: MessageScope;
}

export class MessagePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessagePayloadError';
  }
}

export function validateMessagePayload(payload: MessageEntryPayload): MessageEntryPayload {
  if (payload.author?.type === 'agent' || payload.author?.type === 'tool') {
    if (!payload.author.agentThreadId) {
      throw new MessagePayloadError(`${payload.author.type} author requires agentThreadId`);
    }
  }
  if (payload.scope?.type === 'thread' && !payload.scope.agentThreadId) {
    throw new MessagePayloadError('thread scope requires agentThreadId');
  }
  return payload.mentions
    ? { ...payload, mentions: [...new Set(payload.mentions)] }
    : payload;
}
