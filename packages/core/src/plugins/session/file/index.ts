import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ModelMessage } from '../../../types.js';
import type { Session, SessionProvider, SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface FileSessionProviderOptions {
  dir: string;
}

interface SerializedSession {
  sessionId: string;
  conversation: ModelMessage[];
  currentTurn: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class FileSessionProvider implements SessionProvider {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private filePath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
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
    try {
      const raw = await readFile(this.filePath(sessionId), 'utf-8');
      const data: SerializedSession = JSON.parse(raw);
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

  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }

    const summaries: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      try {
        const filePath = join(this.dir, entry);
        const raw = await readFile(filePath, 'utf-8');
        const body = JSON.parse(raw) as { conversation?: unknown; metadata?: Record<string, unknown>; updatedAt?: string };
        summaries.push({
          sessionId: id,
          title: body.metadata?.title as string | undefined,
          updatedAt: body.updatedAt ? new Date(body.updatedAt) : new Date(0),
          messageCount: Array.isArray(body.conversation) ? body.conversation.length : 0,
        });
      } catch {
        continue;
      }
    }

    summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return summaries;
  }

  private async write(session: Session): Promise<void> {
    const data: SerializedSession = {
      sessionId: session.sessionId,
      conversation: session.conversation,
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
    await writeFile(this.filePath(session.sessionId), JSON.stringify(data, null, 2), 'utf-8');
  }
}

export function createProvider(options: FileSessionProviderOptions | undefined): FileSessionProvider {
  if (!options?.dir) {
    throw new Error('FileSessionProvider requires dir');
  }
  return new FileSessionProvider(options.dir);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): FileSessionProviderOptions {
  return { dir: ctx.sessionsDir };
}
