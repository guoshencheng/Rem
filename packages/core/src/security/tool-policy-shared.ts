export const TOOL_GROUPS: Record<string, string[]> = {
  'group:fs': ['read', 'write', 'edit'],
  'group:runtime': ['exec', 'process'],
  'group:web': ['web_search', 'web_fetch'],
  'group:memory': ['memory_search', 'memory_get'],
  'group:sessions': ['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn'],
  'group:messaging': ['message'],
};

export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function expandToolGroups(entries: string[] | undefined): string[] {
  if (!entries) return [];
  const expanded = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeToolName(entry);
    const group = TOOL_GROUPS[normalized];
    if (group) {
      for (const item of group) expanded.add(item);
    } else {
      expanded.add(normalized);
    }
  }
  return Array.from(expanded);
}
