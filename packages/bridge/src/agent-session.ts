import type { SessionProvider } from 'rem-agent-core';
import type { SessionSummary, SessionUpdate, UIMessage } from './types.js';
import { ServiceError } from './errors.js';
import { runRegistry } from './run-registry.js';

export class AgentSessionManager {
  constructor(private sessionProvider: SessionProvider) {}

  async createSession(): Promise<SessionSummary> {
    const session = await this.sessionProvider.create();
    return this.toSummary(session);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const summaries = await this.sessionProvider.list();
    return summaries
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title ?? 'New Chat',
        pinned: s.pinned,
        updatedAt: s.updatedAt.getTime(),
        messageCount: s.messageCount,
      }))
      .sort((a, b) => {
        if (a.pinned === b.pinned) {
          return b.updatedAt - a.updatedAt;
        }
        return a.pinned ? -1 : 1;
      });
  }

  async getMessages(sessionId: string): Promise<UIMessage[]> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new ServiceError('Session not found', 404);
    }

    return session.conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        parts: msg.content ?? [],
        status: 'done' as const,
      }));
  }

  async updateSession(sessionId: string, updates: SessionUpdate): Promise<void> {
    const session = await this.sessionProvider.load(sessionId);
    if (!session) {
      throw new ServiceError('Session not found', 404);
    }
    if (updates.title !== undefined) {
      session.metadata.title = updates.title;
    }
    if (updates.pinned !== undefined) {
      session.metadata.pinned = updates.pinned;
    }
    session.updatedAt = new Date();
    await this.sessionProvider.save(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    runRegistry.abort(sessionId);
    runRegistry.remove(sessionId);
    await this.sessionProvider.delete(sessionId);
  }

  private toSummary(session: { sessionId: string; metadata?: Record<string, unknown>; updatedAt: Date; conversation?: unknown[] }): SessionSummary {
    return {
      sessionId: session.sessionId,
      title: (session.metadata?.title as string | undefined) ?? 'New Chat',
      pinned: session.metadata?.pinned as boolean | undefined,
      updatedAt: session.updatedAt.getTime(),
      messageCount: Array.isArray(session.conversation) ? session.conversation.length : 0,
    };
  }
}
