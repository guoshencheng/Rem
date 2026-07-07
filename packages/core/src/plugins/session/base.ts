import { randomUUID } from 'crypto';
import type { Session, SessionProvider, SessionSummary } from '../../sdk/session-provider.js';
import type { ModelMessage, ContentPart } from '../../types.js';
import { JsonlSessionStore } from './jsonl-store.js';

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
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.store.save(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    return this.store.load(sessionId);
  }

  addMessage(session: Session, role: 'assistant' | 'tool'): ModelMessage {
    const msg: ModelMessage = { id: randomUUID(), role, content: [] };
    session.conversation.push(msg);
    void this.save(session).catch(() => {});
    return msg;
  }

  appendContent(session: Session, msg: ModelMessage, part: ContentPart): void {
    msg.content.push(part);
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
