import type { SessionStore } from '../../sdk/storage-provider.js';
import { generateId } from '../../shared/generate-id.js';
import type { MessageEntryPayload } from './payload.js';
import { validateMessagePayload } from './payload.js';

export interface AppendMessageInput extends MessageEntryPayload {
  sessionId: string;
}

export class SessionMessageAppender {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly store: Pick<SessionStore, 'appendEntry' | 'getActiveLeafId'>) {}

  append(input: AppendMessageInput): Promise<void> {
    const previous = this.tails.get(input.sessionId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const { sessionId, ...rawPayload } = input;
      const payload = validateMessagePayload(rawPayload);
      const parentId = await this.store.getActiveLeafId(sessionId);
      await this.store.appendEntry({
        id: generateId(), sessionId, parentId, type: 'message', payload, timestamp: Date.now(),
      });
    });
    this.tails.set(input.sessionId, operation);
    void operation.finally(() => {
      if (this.tails.get(input.sessionId) === operation) this.tails.delete(input.sessionId);
    }).catch(() => undefined);
    return operation;
  }
}
