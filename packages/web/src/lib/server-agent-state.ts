import {
  CoreAgent,
  IterationBudget,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  FileSkillProvider,
  NoOpCompressor,
  SimpleErrorHandler,
  FixedBudgetPolicy,
} from 'rem-agent-core';
import type { AgentStreamChunk } from 'rem-agent-core';
import type { SessionProvider, Session, SessionSummary } from 'rem-agent-core';
import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, writeFile, unlink } from 'fs/promises';
import { join, resolve } from 'path';

type Agent = CoreAgent;
type RunResult = ReturnType<Agent['run']>;

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

interface AgentEntry {
  agent: Agent;
  messages: ServerMessage[];
  assistantMsgId: string;
}

const g = globalThis as unknown as {
  _remAgentStore?: Map<string, AgentEntry>;
  _remActiveStreams?: Map<string, { result: RunResult; abort: AbortController }>;
  _remSessionProvider?: LocalSessionProvider;
  _remMemoryProvider?: SimpleMemoryProvider;
};

class LocalSessionProvider implements SessionProvider {
  private dir: string;
  private loaded = false;
  private msgCache = new Map<string, ServerMessage[]>();

  constructor(dir: string) {
    this.dir = resolve(process.cwd(), dir);
  }

  private filePath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  cueMessages(sessionId: string, messages: ServerMessage[]): void {
    this.msgCache.set(sessionId, messages);
  }

  getCachedMessages(sessionId: string): ServerMessage[] {
    return this.msgCache.get(sessionId) ?? [];
  }

  private async ensureDir(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.dir, { recursive: true });
    this.loaded = true;
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
      const raw = await readFile(this.filePath(sessionId), 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.messages)) {
        this.msgCache.set(sessionId, data.messages as ServerMessage[]);
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
    const data = {
      sessionId: session.sessionId,
      conversation: session.conversation,
      messages: this.msgCache.get(session.sessionId) ?? [],
      currentTurn: session.currentTurn,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(this.filePath(session.sessionId), JSON.stringify(data, null, 2), 'utf-8');
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
        const raw = await readFile(join(this.dir, entry), 'utf-8');
        const body = JSON.parse(raw);
        summaries.push({
          sessionId: id,
          title: body.metadata?.title as string | undefined,
          updatedAt: new Date(body.updatedAt),
          messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
        });
      } catch {
        continue;
      }
    }
    return summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async deleteSession(sessionId: string): Promise<void> {
    try { await unlink(this.filePath(sessionId)); } catch { /* ignore */ }
  }
}

if (!g._remAgentStore) g._remAgentStore = new Map();
if (!g._remActiveStreams) g._remActiveStreams = new Map();
if (!g._remSessionProvider) g._remSessionProvider = new LocalSessionProvider('.sessions');
if (!g._remMemoryProvider) g._remMemoryProvider = new SimpleMemoryProvider('Rem Agent');

const agentStore = g._remAgentStore;
const activeStreams = g._remActiveStreams;
const sharedSessionProvider = g._remSessionProvider;
const sharedMemoryProvider = g._remMemoryProvider;

export async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  let entry = agentStore.get(sessionId);
  if (!entry) {
    const agent = new CoreAgent({
      name: 'Rem Agent',
      budget: new IterationBudget({ maxTurns: 60 }),
      provider: 'openai',
      sessionProvider: sharedSessionProvider,
      memoryProvider: sharedMemoryProvider,
      toolProvider: new InMemoryToolProvider(),
      skillProvider: new FileSkillProvider(),
      compressor: new NoOpCompressor(),
      errorHandler: new SimpleErrorHandler(),
      budgetPolicy: new FixedBudgetPolicy({ maxTurns: 60 }),
    });
    await agent.ready();
    await agent.initialize({ sessionId });

    const existingMessages = sharedSessionProvider.getCachedMessages(sessionId);
    entry = { agent, messages: existingMessages, assistantMsgId: '' };
    agentStore.set(sessionId, entry);
  }
  return entry.agent;
}

export function setActiveRun(sessionId: string, result: RunResult, abort: AbortController): void {
  activeStreams.set(sessionId, { result, abort });
}

export function getActiveRun(sessionId: string) {
  return activeStreams.get(sessionId) ?? null;
}

export function clearActiveRun(sessionId: string): void {
  activeStreams.delete(sessionId);
}

export function interruptActiveRun(sessionId: string): boolean {
  const entry = activeStreams.get(sessionId);
  if (entry) {
    entry.abort.abort();
    activeStreams.delete(sessionId);
    return true;
  }
  return false;
}

export async function generateTitle(sessionId: string): Promise<string> {
  const entry = agentStore.get(sessionId);
  if (!entry) return '';
  return entry.agent.generateTitle();
}

export async function listAgentSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }>> {
  const result: Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }> = [];

  // First, include all sessions from disk (survive restart)
  const diskSessions = await sharedSessionProvider.list();
  for (const s of diskSessions) {
    const entry = agentStore.get(s.sessionId);
    result.push({
      sessionId: s.sessionId,
      title: s.title ?? extractTitle(entry?.messages ?? []),
      updatedAt: s.updatedAt.getTime(),
      messageCount: entry?.messages.length ?? s.messageCount,
    });
  }

  // Then add sessions only in agentStore (not yet on disk)
  for (const [sessionId, entry] of agentStore.entries()) {
    if (!result.find((r) => r.sessionId === sessionId)) {
      result.push({
        sessionId,
        title: extractTitle(entry.messages),
        updatedAt: Date.now(),
        messageCount: entry.messages.length,
      });
    }
  }

  return result.sort((a, b) => b.updatedAt - a.updatedAt);
}

function extractTitle(messages: ServerMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  return text.length > 20 ? text.slice(0, 20) + '...' : text;
}

export function addUserMessage(sessionId: string, content: string): void {
  const entry = agentStore.get(sessionId);
  if (!entry) return;
  entry.messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content,
    toolCalls: [],
    status: 'done',
  });
  const assistId = crypto.randomUUID();
  entry.assistantMsgId = assistId;
  entry.messages.push({
    id: assistId,
    role: 'assistant',
    content: '',
    toolCalls: [],
    status: 'pending',
  });
}

export function applyStreamChunk(sessionId: string, chunk: AgentStreamChunk): void {
  const entry = agentStore.get(sessionId);
  if (!entry) return;
  const targetId = entry.assistantMsgId;
  const msg = entry.messages.find((m) => m.id === targetId);
  if (!msg) return;

  if (chunk.type === 'text-delta') {
    msg.content += chunk.text;
    msg.status = 'streaming';
  } else if (chunk.type === 'reasoning-delta') {
    msg.reasoning = (msg.reasoning ?? '') + chunk.text;
    msg.status = 'streaming';
  } else if (chunk.type === 'tool-call-start') {
    msg.toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, arguments: {} });
    msg.status = 'streaming';
  } else if (chunk.type === 'tool-call') {
    const tc = msg.toolCalls.find((t) => t.id === chunk.toolCallId);
    if (tc) tc.arguments = (chunk.input as Record<string, unknown>) ?? {};
  } else if (chunk.type === 'tool-result') {
    const tc = msg.toolCalls.find((t) => t.id === chunk.toolCallId);
    if (tc) {
      tc.result = { success: !chunk.error, output: chunk.output, error: chunk.error, durationMs: 0 };
    }
  } else if (chunk.type === 'finish') {
    msg.status = 'done';
    sharedSessionProvider.cueMessages(sessionId, entry.messages);
  } else if (chunk.type === 'error') {
    msg.status = 'error';
    msg.error = String(chunk.error);
    sharedSessionProvider.cueMessages(sessionId, entry.messages);
  }
}

export function getSessionMessages(sessionId: string): ServerMessage[] {
  return agentStore.get(sessionId)?.messages ?? [];
}

export async function deleteSessionFromStore(sessionId: string): Promise<void> {
  agentStore.delete(sessionId);
  await sharedSessionProvider.deleteSession(sessionId);
}
