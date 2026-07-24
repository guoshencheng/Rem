import type {
  Message, TextContent, ThinkingContent, ToolCall, RemMessage,
  Session, SessionProvider, SessionSummary, SessionStore,
} from 'rem-agent-core/browser';
import { generateId, UnsupportedSessionSchemaError } from 'rem-agent-core/browser';

export class BrowserSessionProvider implements SessionProvider {
  constructor(private store: SessionStore) {}

  async create(): Promise<Session> {
    return this.store.create('default');
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = await this.store.load(sessionId);
    if (!session) return null;
    const schemaVersion = session.metadata?.schemaVersion ?? 1;
    if (schemaVersion < 2) {
      throw new UnsupportedSessionSchemaError(schemaVersion, sessionId);
    }
    return session;
  }

  addMessage(session: Session, role: 'assistant' | 'tool'): RemMessage {
    const messageId = generateId();
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

  async list(): Promise<SessionSummary[]> {
    return this.store.listAll();
  }
}
