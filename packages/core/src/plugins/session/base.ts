import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionProvider, SessionSummary } from '../../sdk/session-provider.js';

export abstract class BaseSessionProvider implements SessionProvider {
  protected dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  protected sessionPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  protected async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async create(): Promise<Session> {
    await this.ensureDir();
    const now = new Date();
    return {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async load(sessionId: string): Promise<Session | null> {
    try {
      const raw = await readFile(this.sessionPath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      return {
        sessionId: data.sessionId,
        conversation: data.conversation ?? [],
        currentTurn: data.currentTurn ?? 0,
        metadata: data.metadata ?? {},
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };
    } catch {
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();
    const updated: Session = {
      ...session,
      updatedAt: new Date(),
    };
    await this.write(updated);
  }

  protected async write(session: Session): Promise<void> {
    const data = {
      sessionId: session.sessionId,
      conversation: session.conversation,
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
    await writeFile(this.sessionPath(session.sessionId), JSON.stringify(data, null, 2), 'utf-8');
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await unlink(this.sessionPath(sessionId));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  abstract list(): Promise<SessionSummary[]>;
}
