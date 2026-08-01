import type { TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { SessionStore } from '../../../sdk/storage-provider.js';
import type { RemMessage } from '../../../agent/types.js';
import type { MessageEntryPayload, SessionTreeEntry } from '../../../session/tree/types.js';
import { SessionMessageAppender } from '../../../session/messages/appender.js';
import { UnsupportedSessionSchemaError } from '../errors.js';

export class DefaultSessionProvider implements SessionProvider {
  private readonly appender: SessionMessageAppender;

  constructor(private store: SessionStore) {
    this.appender = new SessionMessageAppender(store);
  }

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

  async appendMessage(session: Session, payload: MessageEntryPayload): Promise<void> {
    await this.appender.append({ sessionId: session.sessionId, ...payload });
    session.conversation.push(payload.message);
  }

  listEntries(sessionId: string): Promise<SessionTreeEntry[]> {
    return this.store.listEntries(sessionId);
  }

  getActiveLeafId(sessionId: string): Promise<string | null> {
    return this.store.getActiveLeafId(sessionId);
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
