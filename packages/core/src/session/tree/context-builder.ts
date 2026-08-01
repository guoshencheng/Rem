import type { Message } from '@earendil-works/pi-ai';
import type { MessageEntryPayload, SessionTreeEntry } from './types.js';
import { getActiveEntryChain } from '../messages/entry-chain.js';

export function buildConversationFromEntries(
  entries: SessionTreeEntry[],
  leafId: string | null,
): Message[] {
  return getActiveEntryChain(entries, leafId)
    .filter((e) => e.type === 'message')
    .map((e) => (e.payload as MessageEntryPayload).message);
}
