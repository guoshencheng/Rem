import {
  runAgent as coreRunAgent,
  ProviderManager,
  LocalSessionProvider,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  FileSkillProvider,
  NoOpCompressor,
  SimpleErrorHandler,
  FixedBudgetPolicy,
} from 'rem-agent-core';
import type { AgentStreamChunk } from 'rem-agent-core';
import { resolve } from 'path';

type RunResult = ReturnType<typeof coreRunAgent>;

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

interface SessionMessages {
  messages: ServerMessage[];
  assistantMsgId: string;
}

const g = globalThis as unknown as {
  _remActiveStreams?: Map<string, { result: RunResult; abort: AbortController }>;
  _remSessionProvider?: LocalSessionProvider;
  _remMsgCache?: Map<string, SessionMessages>;
  _remPmReady?: Promise<void>;
};

if (!g._remActiveStreams) g._remActiveStreams = new Map();
if (!g._remSessionProvider) g._remSessionProvider = new LocalSessionProvider(resolve(process.cwd(), '.sessions'));
if (!g._remMsgCache) g._remMsgCache = new Map();

const activeStreams = g._remActiveStreams;
const sessionProvider = g._remSessionProvider;
const msgCache = g._remMsgCache;

function ensureProviderManager(): Promise<void> {
  if (!g._remPmReady) {
    ProviderManager.resetInstance();
    g._remPmReady = ProviderManager.getInstance({
      configProvider: {
        getConfig: () => ({
          name: 'Rem Agent', maxTurns: 60, workspaceRoot: process.cwd(), readOnly: false,
          sessionsDir: resolve(process.cwd(), '.sessions'), skillsDir: resolve(process.cwd(), '.skills'),
          toolPolicy: undefined, model: { provider: 'openai', model: '', apiKey: '', baseURL: undefined },
        }),
        getBehaviorConfig: () => ({
          name: 'Rem Agent', maxTurns: 60, workspaceRoot: process.cwd(), readOnly: false,
          sessionsDir: resolve(process.cwd(), '.sessions'), skillsDir: resolve(process.cwd(), '.skills'),
        }),
        getModelConfig: () => ({ provider: 'openai', model: '', apiKey: '', baseURL: undefined }),
        getToolConfig: () => ({ policy: undefined }),
      } as import('rem-agent-core').ConfigProvider,
      sessionProvider: sessionProvider,
      toolProvider: new InMemoryToolProvider(),
      memoryProvider: new SimpleMemoryProvider('Rem Agent'),
      skillProvider: new FileSkillProvider(),
      compressor: new NoOpCompressor(),
      errorHandler: new SimpleErrorHandler(),
      budgetPolicy: new FixedBudgetPolicy({ maxTurns: 60 }),
    }).then(() => {});
  }
  return g._remPmReady;
}

export async function runAgent(sessionId: string, content: string): Promise<RunResult> {
  await ensureProviderManager();
  const abort = new AbortController();
  const result = coreRunAgent({
    input: { content, timestamp: new Date() },
    sessionId,
    signal: abort.signal,
  });
  activeStreams.set(sessionId, { result, abort });
  return result;
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

export async function listAgentSessions() {
  const diskSessions = await sessionProvider.list();
  const result: Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }> = [];

  for (const s of diskSessions) {
    const entry = msgCache.get(s.sessionId);
    result.push({
      sessionId: s.sessionId,
      title: s.title ?? extractTitle(entry?.messages ?? []),
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : Date.now(),
      messageCount: entry?.messages.length ?? s.messageCount,
    });
  }

  for (const [sessionId, entry] of msgCache.entries()) {
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
  let entry = msgCache.get(sessionId);
  if (!entry) {
    entry = { messages: [], assistantMsgId: '' };
    msgCache.set(sessionId, entry);
  }
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
  const entry = msgCache.get(sessionId);
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
    sessionProvider.cueMessages(sessionId, entry.messages);
  } else if (chunk.type === 'error') {
    msg.status = 'error';
    msg.error = String(chunk.error);
    sessionProvider.cueMessages(sessionId, entry.messages);
  }
}

export function getSessionMessages(sessionId: string): ServerMessage[] {
  const entry = msgCache.get(sessionId);
  if (entry?.messages.length) return entry.messages;
  return (sessionProvider.pullMessages(sessionId) ?? []) as ServerMessage[];
}

export async function deleteSessionFromStore(sessionId: string): Promise<void> {
  msgCache.delete(sessionId);
  await sessionProvider.delete(sessionId);
}
