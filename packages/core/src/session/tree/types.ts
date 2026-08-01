export type { MessageEntryPayload } from '../messages/payload.js';

export type SessionTreeEntryType = 'message' | 'model_change' | 'label';

export interface SessionTreeEntry {
  id: string;
  sessionId: string;
  parentId: string | null;
  type: SessionTreeEntryType;
  payload: unknown;
  timestamp: number;
}
