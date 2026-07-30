import type { Session } from '../../../session/model.js';
import type { SessionTreeEntry } from '../../../session/tree/types.js';
import { buildConversationFromEntries } from '../../../session/tree/context-builder.js';
import { generateId } from '../../../shared/generate-id.js';

/** reconcile 依赖的最小 Store 面（由 SqliteSessionStore 满足） */
export interface SessionEntryStore {
  listEntries(sessionId: string): Promise<SessionTreeEntry[]>;
  getActiveLeafId(sessionId: string): Promise<string | null>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  updateEntry(entry: SessionTreeEntry): void;
}

/**
 * 过渡期 reconcile：旧流程通过 save() 持久化消息，新流程经 appendEntry 增量写入。
 * 对比 leaf 链后，新流程下此函数自然成为 no-op。
 */
export async function reconcileSessionEntries(store: SessionEntryStore, session: Session): Promise<void> {
  const entries = await store.listEntries(session.sessionId);
  const leafId = await store.getActiveLeafId(session.sessionId);
  const persisted = buildConversationFromEntries(entries, leafId);

  if (session.conversation.length > persisted.length) {
    for (let i = persisted.length; i < session.conversation.length; i++) {
      const message = session.conversation[i];
      const entryId = generateId();
      await store.appendEntry({
        id: entryId,
        sessionId: session.sessionId,
        parentId: await store.getActiveLeafId(session.sessionId),
        type: 'message',
        payload: { message, messageId: entryId },
        timestamp: Date.now(),
      });
    }
  } else if (session.conversation.length > 0 && session.conversation.length === persisted.length) {
    const lastMessage = session.conversation[session.conversation.length - 1];
    const lastPersisted = persisted[persisted.length - 1];
    if (JSON.stringify(lastMessage) !== JSON.stringify(lastPersisted)) {
      const leafEntry = entries.find((e) => e.id === leafId);
      if (leafEntry) {
        const messageId = (leafEntry.payload as { messageId?: string }).messageId ?? leafEntry.id;
        store.updateEntry({ ...leafEntry, payload: { message: lastMessage, messageId } });
      }
    }
  }
}
