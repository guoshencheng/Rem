import type { SessionStore } from '../../sdk/storage-provider.js';
import { generateId } from '../../shared/generate-id.js';
import type { MessageEntryPayload } from './payload.js';
import { validateMessagePayload } from './payload.js';
import { SessionWriteCoordinator } from './write-coordinator.js';

export interface AppendMessageInput extends MessageEntryPayload {
  sessionId: string;
}

export class SessionMessageAppender {
  constructor(
    private readonly store: Pick<SessionStore, 'appendEntry' | 'getActiveLeafId'>,
    private readonly coordinator = new SessionWriteCoordinator(),
  ) {}

  append(input: AppendMessageInput): Promise<void> {
    return this.coordinator.run(input.sessionId, async () => {
      const { sessionId, ...rawPayload } = input;
      const payload = validateMessagePayload(rawPayload);
      const parentId = await this.store.getActiveLeafId(sessionId);
      await this.store.appendEntry({
        id: generateId(), sessionId, parentId, type: 'message', payload, timestamp: Date.now(),
      });
    });
  }
}
