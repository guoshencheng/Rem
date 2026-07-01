import { randomUUID } from 'crypto';
import { type ModelMessage } from './types.js';

export interface Session {
  sessionId: string;
  conversation: ModelMessage[];
  currentTurn: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: Date;
  messageCount: number;
}
