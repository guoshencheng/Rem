import { randomUUID } from 'crypto';
import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Session, SessionProvider, SessionSummary } from '../../sdk/session-provider.js';
import type { RemMessage } from '../../types.js';
import { JsonlSessionStore } from './jsonl-store.js';
import { migrateConversationToPiAi } from '../../pi-adapter.js';

export abstract class BaseSessionProvider implements SessionProvider {
  protected store: JsonlSessionStore;

  constructor(dir: string) {
    this.store = new JsonlSessionStore(dir);
  }

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
    await this.store.save(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = await this.store.load(sessionId);
    if (!session) return null;

    if ((session.metadata?.schemaVersion ?? 1) < 2) {
      const { messages, messageIds } = migrateConversationToPiAi(session.conversation as any);
      session.conversation = messages;
      const messageMeta: Record<string, string> = {};
      for (const [key, value] of messageIds) {
        messageMeta[key] = value;
      }
      session.metadata = {
        ...session.metadata,
        schemaVersion: 2,
        messageMeta: { ...(session.metadata?.messageMeta as Record<string, string>), ...messageMeta },
      };
      await this.store.save(session);
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
    await this.store.save(session);
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  abstract list(): Promise<SessionSummary[]>;
}
