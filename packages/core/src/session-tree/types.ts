import type { Message } from '@earendil-works/pi-ai';

export type SessionTreeEntryType = 'message' | 'model_change' | 'label';

export interface MessageEntryPayload {
  message: Message;
  messageId: string;
}

export interface SessionTreeEntry {
  id: string;
  sessionId: string;
  parentId: string | null;
  type: SessionTreeEntryType;
  payload: unknown;
  timestamp: number;
}
