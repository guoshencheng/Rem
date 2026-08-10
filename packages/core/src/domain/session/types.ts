import type { Message } from '@earendil-works/pi-ai';
import type { ContextSet } from '../context/types.js';

export interface AgentSession {
  sessionId: string;
  tenantId: string;
  contexts: ContextSet;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuntimeSessionEntry {
  entryId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  message: Message;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
