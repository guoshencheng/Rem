import type { TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { StorageProvider } from '../../../sdk/storage-provider.js';
import type { RemMessage } from '../../../agent/types.js';
import type { MessageEntryPayload, SessionTreeEntry } from '../../../session/tree/types.js';
import { SessionMessageAppender } from '../../../session/messages/appender.js';
import { UnsupportedSessionSchemaError } from '../errors.js';
import type { MessageDelivery } from '../../../orchestration/delivery-model.js';
import { SessionWriteCoordinator } from '../../../session/messages/write-coordinator.js';
import { generateId } from '../../../shared/generate-id.js';
import { validateMessagePayload } from '../../../session/messages/payload.js';

export class DefaultSessionProvider implements SessionProvider {
  private readonly appender: SessionMessageAppender;

  private readonly coordinator = new SessionWriteCoordinator();

  constructor(private storage: StorageProvider) {
    this.appender = new SessionMessageAppender(storage.sessionStore, this.coordinator);
  }

  async create(): Promise<Session> {
    return this.storage.sessionStore.create('default');
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = await this.storage.sessionStore.load(sessionId);
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

  async appendMessageWithDeliveries(
    session: Session,
    rawPayload: MessageEntryPayload,
    deliveries: MessageDelivery[],
  ): Promise<void> {
    await this.coordinator.run(session.sessionId, async () => {
      const payload = validateMessagePayload(rawPayload);
      const parentId = await this.storage.sessionStore.getActiveLeafId(session.sessionId);
      await this.storage.orchestrationStore.appendMessageWithDeliveries({
        id: generateId(), sessionId: session.sessionId, parentId,
        type: 'message', payload, timestamp: Date.now(),
      }, deliveries);
    });
    session.conversation.push(rawPayload.message);
  }

  listEntries(sessionId: string): Promise<SessionTreeEntry[]> {
    return this.storage.sessionStore.listEntries(sessionId);
  }

  getActiveLeafId(sessionId: string): Promise<string | null> {
    return this.storage.sessionStore.getActiveLeafId(sessionId);
  }

  async save(session: Session): Promise<void> {
    await this.storage.sessionStore.save(session);
  }

  async delete(sessionId: string): Promise<void> {
    await this.storage.sessionStore.delete(sessionId);
  }

  async list(): Promise<SessionSummary[]> {
    return this.storage.sessionStore.listAll();
  }
}
