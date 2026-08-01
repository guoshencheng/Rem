import type { SessionTreeEntry } from '../tree/types.js';

export function getActiveEntryChain(
  entries: SessionTreeEntry[],
  leafId: string | null,
): SessionTreeEntry[] {
  if (!leafId) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chain: SessionTreeEntry[] = [];
  let current = byId.get(leafId);
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse();
}
