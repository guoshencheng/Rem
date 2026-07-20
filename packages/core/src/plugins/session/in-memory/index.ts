import { randomUUID } from 'crypto';
import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { RemMessage } from '../../../types.js';
import { UnsupportedSessionSchemaError } from '../errors.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';

export class InMemorySessionProvider implements SessionProvider {
  private sessions = new Map<string, Session>();

  async create(): Promise<Session> {
    const now = new Date();
    const session: Session = {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: { schemaVersion: 2 },
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.sessionId, structuredClone(session));
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return null;
    const session = structuredClone(stored);
    const schemaVersion = session.metadata?.schemaVersion ?? 1;
    if (schemaVersion < 2) {
      throw new UnsupportedSessionSchemaError(schemaVersion, sessionId);
    }
    return session;
  }

  addMessage(session: Session, role: 'assistant' | 'tool'): RemMessage {
    const messageId = randomUUID();
    let message: Message;
    if (role === 'assistant') {
      message = { role: 'assistant', content: [], timestamp: Date.now() } as unknown as Message;
    } else {
      message = { role: 'toolResult', toolCallId: '', toolName: '', content: [], isError: false, timestamp: Date.now() } as unknown as Message;
    }
    session.conversation.push(message);
    const messageMeta = (session.metadata.messageMeta ?? {}) as Record<string, string>;
    messageMeta[messageId] = messageId;
    session.metadata = { ...session.metadata, messageMeta };
    void this.save(session).catch(() => {});
    return { messageId, message };
  }

  appendContent(session: Session, message: Message, block: TextContent | ThinkingContent | ToolCall): void {
    (message.content as unknown[]).push(block);
    void this.save(session).catch(() => {});
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
        title: getMetaString(session.metadata, 'title'),
        pinned: getMetaBoolean(session.metadata, 'pinned'),
        updatedAt: session.updatedAt,
        messageCount: session.conversation.length,
      });
    }
    result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return result;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
