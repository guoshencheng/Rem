import type { Message } from '@earendil-works/pi-ai';
import type { SessionTreeEntry } from '../tree/types.js';
import { getActiveEntryChain } from './entry-chain.js';
import type { MessageEntryPayload } from './payload.js';
import { normalizeMessagePayload } from './normalize.js';

export interface SessionChatMessage {
  messageId: string;
  message: Message;
  authorThreadId?: string;
  mentions?: string[];
  replyToMessageId?: string;
  rootUserMessageId?: string;
}

export function projectSessionChat(
  entries: SessionTreeEntry[],
  leafId: string | null,
  primaryThreadId: string,
): SessionChatMessage[] {
  return getActiveEntryChain(entries, leafId).flatMap((entry) => {
    if (entry.type !== 'message') return [];
    const payload = normalizeMessagePayload(entry.payload as MessageEntryPayload, primaryThreadId);
    if (!isPublicChatMessage(payload)) return [];
    return [{
      messageId: payload.messageId,
      message: payload.message,
      authorThreadId: payload.author.type === 'agent' ? payload.author.agentThreadId : undefined,
      mentions: payload.mentions,
      replyToMessageId: payload.replyToMessageId,
      rootUserMessageId: payload.rootUserMessageId,
    }];
  });
}

function isPublicChatMessage(payload: ReturnType<typeof normalizeMessagePayload>): boolean {
  if (payload.scope.type !== 'session') return false;
  if (payload.author.type === 'tool' || payload.message.role === 'toolResult') return false;
  if (payload.message.role !== 'assistant') return payload.author.type === 'user';
  return payload.message.content.some((part) => part.type === 'text');
}
