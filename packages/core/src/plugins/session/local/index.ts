import { readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
import { BaseSessionProvider } from '../base.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';
import type { ContentPart } from '../../../types.js';

interface IndexEntry {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: string;
  messageCount: number;
}

export class LocalSessionProvider extends BaseSessionProvider {
  private msgCache = new Map<string, ContentPart[]>();
  private dir: string;

  constructor(dir: string) {
    super(dir);
    this.dir = dir;
  }

  private indexPath(): string {
    return join(this.dir, 'index.json');
  }

  private msgPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.msg.json`);
  }

  async create(): Promise<Session> {
    const session = await super.create();
    await this.updateIndex(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    const session = await this.store.load(sessionId);
    if (!session) return null;
    try {
      const raw = await readFile(this.msgPath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.msgCache.set(sessionId, data);
      }
    } catch {
      // msg cache is optional
    }
    return session;
  }

  async save(session: Session): Promise<void> {
    await this.store.save(session);
    await this.writeMsgCache(session.sessionId);
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
    this.msgCache.delete(sessionId);
    await this.store.delete(sessionId);
    await this.unlinkQuiet(this.msgPath(sessionId));
    await this.removeFromIndex(sessionId);
  }

  cueMessages(sessionId: string, messages: ContentPart[]): void {
    this.msgCache.set(sessionId, messages);
  }

  pullMessages(sessionId: string): ContentPart[] {
    return this.msgCache.get(sessionId) ?? [];
  }

  private async writeMsgCache(sessionId: string): Promise<void> {
    const messages = this.msgCache.get(sessionId);
    if (!messages) return;
    await writeFile(this.msgPath(sessionId), JSON.stringify(messages, null, 2), 'utf-8');
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

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // ignore
    }
  }
}
