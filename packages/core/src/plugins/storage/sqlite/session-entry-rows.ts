import type { SessionTreeEntry } from '../../../session/tree/types.js';

/** session_entries 表行结构 */
export interface SessionEntryRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  type: string;
  payload: string;
  created_at: number;
}

export function toSessionTreeEntry(row: SessionEntryRow): SessionTreeEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    type: row.type as SessionTreeEntry['type'],
    payload: JSON.parse(row.payload),
    timestamp: row.created_at,
  };
}
