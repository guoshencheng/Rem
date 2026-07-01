import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { BaseSessionProvider } from '../base.js';
import { getMetaBoolean, getMetaString } from '../metadata.js';

import type { ContentPart } from '../../../types.js';

export interface LocalSessionProviderOptions {
  dir: string;
}

interface IndexEntry {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: string;
  messageCount: number;
}

export class LocalSessionProvider extends BaseSessionProvider {
  private msgCache = new Map<string, ContentPart[]>();

  constructor(dir: string) {
    super(dir);
  }

  private indexPath(): string {
    return join(this.dir, 'index.json');
  }

  async create(): Promise<Session> {
    const session = await super.create();
    await this.write(session);
    await this.updateIndex(session);
    return session;
  }

  async load(sessionId: string): Promise<Session | null> {
    try {
      const raw = await readFile(this.sessionPath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.messages)) {
        this.msgCache.set(sessionId, data.messages);
      }
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
    const updated = await this.persist(session);
    await this.updateIndex(updated);
  }

  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
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
    await super.delete(sessionId);
    await this.removeFromIndex(sessionId);
  }

  cueMessages(sessionId: string, messages: ContentPart[]): void {
    this.msgCache.set(sessionId, messages);
  }

  pullMessages(sessionId: string): ContentPart[] {
    return this.msgCache.get(sessionId) ?? [];
  }

  protected async write(session: Session): Promise<void> {
    const data = {
      sessionId: session.sessionId,
      conversation: session.conversation,
      messages: this.msgCache.get(session.sessionId) ?? [],
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
    await writeFile(this.sessionPath(session.sessionId), JSON.stringify(data, null, 2), 'utf-8');
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

export function createProvider(options: LocalSessionProviderOptions | undefined): LocalSessionProvider {
  if (!options?.dir) {
    throw new Error('LocalSessionProvider requires dir');
  }
  return new LocalSessionProvider(options.dir);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): LocalSessionProviderOptions {
  return { dir: ctx.sessionsDir };
}
