import type { SessionProvider, Session, SessionSummary } from 'rem-agent-core';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { join, resolve } from 'path';

export interface ServerMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: { success: boolean; output: string; error?: string; durationMs: number };
  }>;
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
}

function extractTitle(messages: ServerMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  return text.length > 20 ? text.slice(0, 20) + '...' : text;
}

export interface IndexEntry {
  sessionId: string;
  title?: string;
  updatedAt: string;
  messageCount: number;
}

export class LocalSessionStore {
  private dir: string;
  private loaded = false;
  private msgCache = new Map<string, ServerMessage[]>();

  constructor(dir: string) {
    this.dir = resolve(process.cwd(), dir);
  }

  private sessionPath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  private indexPath(): string {
    return join(this.dir, 'index.json');
  }

  cacheMessages(sessionId: string, messages: ServerMessage[]): void {
    this.msgCache.set(sessionId, messages);
  }

  getMessages(sessionId: string): ServerMessage[] {
    return this.msgCache.get(sessionId) ?? [];
  }

  private async ensureDir(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.dir, { recursive: true });
    this.loaded = true;
  }

  async saveSession(session: Session): Promise<void> {
    await this.ensureDir();
    const messages = this.msgCache.get(session.sessionId) ?? [];
    const data = {
      sessionId: session.sessionId,
      conversation: session.conversation,
      messages,
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(this.sessionPath(session.sessionId), JSON.stringify(data, null, 2), 'utf-8');

    // 同步更新 index.json
    const index = await this.readIndex();
    const title = session.metadata?.title as string | undefined ?? extractTitle(messages);
    const existing = index.findIndex((s) => s.sessionId === session.sessionId);
    const entry: IndexEntry = { sessionId: session.sessionId, title, updatedAt: new Date().toISOString(), messageCount: messages.length };
    if (existing >= 0) {
      index[existing] = entry;
    } else {
      index.push(entry);
    }
    index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await this.writeIndex(index);
  }

  async loadSession(sessionId: string): Promise<{ session: Session | null; messages: ServerMessage[] }> {
    try {
      const raw = await readFile(this.sessionPath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      const messages = Array.isArray(data.messages) ? (data.messages as ServerMessage[]) : [];
      this.msgCache.set(sessionId, messages);
      return {
        session: {
          sessionId: data.sessionId,
          conversation: data.conversation ?? [],
          currentTurn: data.currentTurn ?? 0,
          metadata: data.metadata ?? {},
          createdAt: new Date(data.createdAt),
          updatedAt: new Date(data.updatedAt),
        },
        messages,
      };
    } catch {
      return { session: null, messages: [] };
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.ensureDir();
    const index = await this.readIndex();
    return index.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      updatedAt: new Date(s.updatedAt),
      messageCount: s.messageCount,
    }));
  }

  async deleteSession(sessionId: string): Promise<void> {
    try { await unlink(this.sessionPath(sessionId)); } catch { /* ignore */ }
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
