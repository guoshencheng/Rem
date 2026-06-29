import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import type { ModelMessage } from '../../../types.js';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface LocalSessionProviderOptions {
  dir: string;
}

interface IndexEntry {
  sessionId: string;
  title?: string;
  updatedAt: string;
  messageCount: number;
}

interface SerializedSession {
  sessionId: string;
  conversation: ModelMessage[];
  currentTurn: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class LocalSessionProvider implements SessionProvider {
  private dir: string;
  private _msgCache = new Map<string, unknown[]>();

  constructor(dir: string) {
    this.dir = dir;
  }

  private sessionPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  private indexPath(): string {
    return join(this.dir, 'index.json');
  }

  private async ensureDir(): Promise<void> {
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
      if (Array.isArray(data.messages)) {
        this._msgCache.set(sessionId, data.messages);
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
    await this.ensureDir();
    const updated = { ...session, updatedAt: new Date() };
    await this.write(updated);
    await this.updateIndex(session);
  }

  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
    const index = await this.readIndex();
    return index.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      updatedAt: new Date(s.updatedAt),
      messageCount: s.messageCount,
    }));
  }

  async delete(sessionId: string): Promise<void> {
    this._msgCache.delete(sessionId);
    try { await unlink(this.sessionPath(sessionId)); } catch { /* ignore */ }
    await this.removeFromIndex(sessionId);
  }

  cueMessages(sessionId: string, messages: unknown[]): void {
    this._msgCache.set(sessionId, messages);
  }

  pullMessages(sessionId: string): unknown[] {
    return this._msgCache.get(sessionId) ?? [];
  }

  private async write(session: Session): Promise<void> {
    const data = {
      sessionId: session.sessionId,
      conversation: session.conversation,
      messages: this._msgCache.get(session.sessionId) ?? [],
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
      title: session.metadata.title as string | undefined,
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
