import type { Message } from '@earendil-works/pi-ai';
import type { Session, SessionSummary } from '../session.js';

export type { Session, SessionSummary };

export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionSummary[]>;

  /** 追加一条已完成的消息并持久化为 tree entry */
  appendMessage(session: Session, message: Message, messageId: string): Promise<void>;
}
