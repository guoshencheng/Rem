import { randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import type { Session, SessionProvider, SessionSummary } from '../../sdk/session-provider.js';
import { JsonlSessionStore } from './jsonl-store.js';

export abstract class BaseSessionProvider implements SessionProvider {
  protected store: JsonlSessionStore;

  constructor(dir: string) {
    this.store = new JsonlSessionStore(dir);
  }

  async create(): Promise<Session> {
    await this.ensureDir();
    const now = new Date();
    const session: Session = {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.write(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    return this.store.load(sessionId);
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();
    await this.store.save(session);
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  protected async ensureDir(): Promise<void> {
    await mkdir(this.store.dir, { recursive: true });
  }

  protected async write(session: Session): Promise<void> {
    await this.store.save(session);
  }

  abstract list(): Promise<SessionSummary[]>;
}
