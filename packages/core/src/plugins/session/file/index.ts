import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../../sdk/session-provider.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { BaseSessionProvider } from '../base.js';

export interface FileSessionProviderOptions {
  dir: string;
}

export class FileSessionProvider extends BaseSessionProvider {
  constructor(dir: string) {
    console.log(`FileSessionProvider initialized with dir: ${dir}`);
    super(dir);
  }

  async create(): Promise<Session> {
    const session = await super.create();
    await this.write(session);
    return session;
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
}

export function createProvider(options: FileSessionProviderOptions | undefined): FileSessionProvider {
  if (!options?.dir) {
    throw new Error('FileSessionProvider requires dir');
  }
  return new FileSessionProvider(options.dir);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): FileSessionProviderOptions {
  throw new Error(ctx.sessionsDir ? '' : 'FileSessionProvider requires sessionsDir in context');
  return { dir: ctx.sessionsDir };
}
