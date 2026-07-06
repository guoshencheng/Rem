import { mkdir, readFile, writeFile, appendFile, unlink, readdir, rename } from 'fs/promises';
import { join } from 'path';
import type { Session, SessionSummary } from '../../sdk/session-provider.js';
import type { ModelMessage } from '../../types.js';

export class JsonlSessionStore {
  private counts = new Map<string, number>();

  constructor(private dir: string) {}

  private jsonlPath(id: string): string { return join(this.dir, `${id}.jsonl`); }
  private metaPath(id: string): string { return join(this.dir, `${id}.meta.json`); }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async load(sessionId: string): Promise<Session | null> {
    const conversation = await this.readMessages(sessionId);
    const meta = await this.readMeta(sessionId);
    if (!conversation && !meta) return null;
    this.counts.set(sessionId, conversation?.length ?? 0);
    return {
      sessionId,
      conversation: conversation ?? [],
      currentTurn: meta?.currentTurn ?? 0,
      metadata: meta?.metadata ?? {},
      createdAt: meta?.createdAt ?? new Date(0),
      updatedAt: meta?.updatedAt ?? new Date(0),
    };
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();
    if (!this.counts.has(session.sessionId)) {
      const existing = await this.readMessages(session.sessionId);
      this.counts.set(session.sessionId, existing?.length ?? 0);
    }
    const count = this.counts.get(session.sessionId)!;
    const newMessages = session.conversation.slice(count);
    if (newMessages.length > 0) {
      const lines = newMessages.map((m) => JSON.stringify(m)).join('\n') + '\n';
      await appendFile(this.jsonlPath(session.sessionId), lines, 'utf-8');
      this.counts.set(session.sessionId, session.conversation.length);
    }
    session.updatedAt = new Date();
    await this.writeMeta(session);
  }

  async delete(sessionId: string): Promise<void> {
    this.counts.delete(sessionId);
    await this.unlinkQuiet(this.jsonlPath(sessionId));
    await this.unlinkQuiet(this.metaPath(sessionId));
  }

  async listSummaries(): Promise<SessionSummary[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const summaries: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.meta.json')) continue;
      const id = entry.slice(0, -'.meta.json'.length);
      const meta = await this.readMeta(id);
      if (!meta) continue;
      const conversation = await this.readMessages(id);
      summaries.push({
        sessionId: id,
        title: typeof meta.metadata?.title === 'string' ? meta.metadata.title : undefined,
        pinned: meta.metadata?.pinned === true ? true : undefined,
        updatedAt: meta.updatedAt,
        messageCount: conversation?.length ?? 0,
      });
    }
    summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return summaries;
  }

  private async readMessages(sessionId: string): Promise<ModelMessage[] | null> {
    let raw: string;
    try {
      raw = await readFile(this.jsonlPath(sessionId), 'utf-8');
    } catch {
      return null;
    }
    const messages: ModelMessage[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed) as ModelMessage);
      } catch {
        return null;
      }
    }
    return messages;
  }

  private async readMeta(sessionId: string): Promise<Partial<Session> & { updatedAt: Date; createdAt: Date } | null> {
    let raw: string;
    try {
      raw = await readFile(this.metaPath(sessionId), 'utf-8');
    } catch {
      return null;
    }
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      return {
        currentTurn: typeof data.currentTurn === 'number' ? data.currentTurn : 0,
        metadata: data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {},
        createdAt: data.createdAt ? new Date(String(data.createdAt)) : new Date(0),
        updatedAt: data.updatedAt ? new Date(String(data.updatedAt)) : new Date(0),
      };
    } catch {
      return null;
    }
  }

  private async writeMeta(session: Session): Promise<void> {
    const data = {
      sessionId: session.sessionId,
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    };
    const tmpPath = `${this.metaPath(session.sessionId)}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, this.metaPath(session.sessionId));
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // ignore
    }
  }
}
