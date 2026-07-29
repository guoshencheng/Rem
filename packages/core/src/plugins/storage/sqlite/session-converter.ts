import type { Message } from '@earendil-works/pi-ai';
import type { Session, SessionSummary } from '../../../session.js';

export interface SessionRow {
  id: string;
  workspace: string;
  title: string | null;
  pinned: number;
  current_turn: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export function toSession(row: SessionRow, messages: Message[]): Session {
  return {
    sessionId: row.id,
    conversation: messages,
    currentTurn: row.current_turn,
    metadata: parseMetadata(row),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function toSessionSummary(row: {
  id: string;
  title: string | null;
  pinned: number;
  updated_at: string;
  message_count: number;
}): SessionSummary {
  return {
    sessionId: row.id,
    title: row.title ?? undefined,
    pinned: row.pinned === 1 ? true : undefined,
    updatedAt: new Date(row.updated_at),
    messageCount: row.message_count,
  };
}

function parseMetadata(row: SessionRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.metadata_json) as Record<string, unknown>;
    if (row.title) parsed.title = row.title;
    if (row.pinned === 1) parsed.pinned = true;
    parsed.workspace = row.workspace;
    return parsed;
  } catch {
    return {
      title: row.title ?? undefined,
      pinned: row.pinned === 1 ? true : undefined,
      workspace: row.workspace,
    };
  }
}
