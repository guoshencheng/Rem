import type { Session, SessionSummary } from '../session.js';

export type { Session, SessionSummary };

export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  list(): Promise<SessionSummary[]>;
}
