import type { Message } from '@earendil-works/pi-ai';
import type { ContextSet } from '../context/types.js';

export interface AgentSession {
  sessionId: string;
  tenantId: string;
  contexts: ContextSet;
  /** Monotonic optimistic-concurrency version. Legacy rows may omit it. */
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lightweight read model used by session lists. The count only includes
 * user-visible conversation messages (user and assistant roles).
 */
export interface RuntimeSessionSummary extends AgentSession {
  messageCount: number;
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
