import type { Message } from '@earendil-works/pi-ai';
import type { MessageEntryPayload, SessionTreeEntry } from './types.js';

export function buildConversationFromEntries(
  entries: SessionTreeEntry[],
  leafId: string | null,
): Message[] {
  if (!leafId) return [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const chain: SessionTreeEntry[] = [];
  let current: SessionTreeEntry | undefined = byId.get(leafId);
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  chain.reverse();
  return chain
    .filter((e) => e.type === 'message')
    .map((e) => (e.payload as MessageEntryPayload).message);
}
