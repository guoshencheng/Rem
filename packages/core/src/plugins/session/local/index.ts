import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
import { BaseSessionProvider } from '../base.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';

interface IndexEntry {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: string;
  messageCount: number;
}

export class LocalSessionProvider extends BaseSessionProvider {
  private dir: string;

  constructor(dir: string) {
    super(dir);
    this.dir = dir;
  }

  private indexPath(): string {
    return join(this.dir, 'index.json');
  }

  async create(): Promise<Session> {
    const session = await super.create();
    await this.updateIndex(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    return super.load(sessionId);
  }

  async save(session: Session): Promise<void> {
    await this.store.save(session);
    await this.updateIndex(session);
  }

  async list(): Promise<SessionSummary[]> {
    const index = await this.readIndex();
    return index.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      pinned: s.pinned,
      updatedAt: new Date(s.updatedAt),
      messageCount: s.messageCount,
    }));
  }

  async delete(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
    await this.removeFromIndex(sessionId);
  }

  private async updateIndex(session: Session): Promise<void> {
    const index = await this.readIndex();
    const count = Array.isArray(session.conversation) ? session.conversation.length : 0;
    const existing = index.findIndex((s) => s.sessionId === session.sessionId);
    const entry: IndexEntry = {
      sessionId: session.sessionId,
      title: getMetaString(session.metadata, 'title'),
      pinned: getMetaBoolean(session.metadata, 'pinned'),
      updatedAt: session.updatedAt.toISOString(),
      messageCount: count,
    };
    if (existing >= 0) {
      index[existing] = entry;
    } else {
      index.push(entry);
    }
    index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.writeIndex(index);
  }

  private async removeFromIndex(sessionId: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex(index.filter((s) => s.sessionId !== sessionId));
  }

  private async readIndex(): Promise<IndexEntry[]> {
    try {
      const raw = await readFile(this.indexPath(), 'utf-8');
      return JSON.parse(raw) as IndexEntry[];
    } catch {
      return [];
    }
  }

  private async writeIndex(index: IndexEntry[]): Promise<void> {
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2), 'utf-8');
  }
}
