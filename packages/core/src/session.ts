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
  updatedAt: Date;
  messageCount: number;
}

export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  list(): Promise<SessionSummary[]>;
}

export class InMemorySessionProvider implements SessionProvider {
  private sessions = new Map<string, Session>();

  async create(): Promise<Session> {
    const now = new Date();
    const session: Session = {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.sessionId, structuredClone(session));
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return null;
    return structuredClone(stored);
  }

  async save(session: Session): Promise<void> {
    const updated: Session = {
      ...session,
      updatedAt: new Date(),
    };
    this.sessions.set(session.sessionId, structuredClone(updated));
  }

  async list(): Promise<SessionSummary[]> {
    const result: SessionSummary[] = [];
    for (const session of this.sessions.values()) {
      result.push({
        sessionId: session.sessionId,
        title: session.metadata.title as string | undefined,
        updatedAt: session.updatedAt,
        messageCount: session.conversation.length,
      });
    }
    result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return result;
  }
}
