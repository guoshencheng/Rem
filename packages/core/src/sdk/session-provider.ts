import type { Session, SessionSummary } from '../session/model.js';
import type { MessageEntryPayload, SessionTreeEntry } from '../session/tree/types.js';
import type { MessageDelivery } from '../orchestration/delivery-model.js';

export type { Session, SessionSummary };

export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionSummary[]>;

  /** 追加一条已完成的消息并持久化为 tree entry */
  appendMessage(session: Session, payload: MessageEntryPayload): Promise<void>;
  appendMessageWithDeliveries(
    session: Session,
    payload: MessageEntryPayload,
    deliveries: MessageDelivery[],
  ): Promise<void>;
  listEntries(sessionId: string): Promise<SessionTreeEntry[]>;
  getActiveLeafId(sessionId: string): Promise<string | null>;
}
