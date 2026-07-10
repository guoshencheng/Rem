import { randomUUID } from 'node:crypto';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { ContentPart, ModelMessage } from '../../../types.js';
import type { SessionStore } from '../../../storage/types.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';

export class SqliteSessionProvider implements SessionProvider {
  constructor(private store: SessionStore) {}

  async create(): Promise<Session> {
    return this.store.create('default');
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

  async list(): Promise<SessionSummary[]> {
    return this.store.listAll();
  }
}
