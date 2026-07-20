import { randomUUID } from 'crypto';
import type { Message } from '@earendil-works/pi-ai';

export interface Session {
  sessionId: string;
  conversation: Message[];
  currentTurn: number;
  metadata: Record<string, unknown> & { schemaVersion?: number };
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: Date;
  messageCount: number;
  parentSessionId?: string;
}
