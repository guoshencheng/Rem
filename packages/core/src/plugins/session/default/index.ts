import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { SessionStore } from '../../../sdk/storage-provider.js';
import type { RemMessage } from '../../../agent/types.js';
import { generateId } from '../../../shared/generate-id.js';
import { UnsupportedSessionSchemaError } from '../errors.js';

export class DefaultSessionProvider implements SessionProvider {
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

  async appendMessage(session: Session, message: Message, messageId: string): Promise<void> {
    const parentId = await this.store.getActiveLeafId(session.sessionId);
    await this.store.appendEntry({
      id: generateId(),
      sessionId: session.sessionId,
      parentId,
      type: 'message',
      payload: { message, messageId },
      timestamp: Date.now(),
    });
    session.conversation.push(message);
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
