import {
  CoreAgent,
  IterationBudget,
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

if (!g._remAgentStore) g._remAgentStore = new Map();
if (!g._remActiveStreams) g._remActiveStreams = new Map();
if (!g._remSessionProvider) g._remSessionProvider = new LocalSessionProvider(resolve(process.cwd(), '.sessions'));
if (!g._remMemoryProvider) g._remMemoryProvider = new SimpleMemoryProvider('Rem Agent');

const agentStore = g._remAgentStore;
const activeStreams = g._remActiveStreams;
const sessionProvider = g._remSessionProvider;
const sharedMemoryProvider = g._remMemoryProvider;

export async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  let entry = agentStore.get(sessionId);
  if (!entry) {
    const agent = new CoreAgent({
      name: 'Rem Agent',
      budget: new IterationBudget({ maxTurns: 60 }),
      provider: 'openai',
      sessionProvider,
      memoryProvider: sharedMemoryProvider,
      toolProvider: new InMemoryToolProvider(),
      skillProvider: new FileSkillProvider(),
      compressor: new NoOpCompressor(),
      errorHandler: new SimpleErrorHandler(),
      budgetPolicy: new FixedBudgetPolicy({ maxTurns: 60 }),
    });
    await agent.ready();
    await agent.initialize({ sessionId });

    const existing = (sessionProvider.pullMessages(sessionId) ?? []) as ServerMessage[];
    entry = { agent, messages: existing, assistantMsgId: '' };
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

export async function listAgentSessions() {
  const diskSessions = await sessionProvider.list();
  const result: Array<{ sessionId: string; title?: string; updatedAt: number; messageCount: number }> = [];

  for (const s of diskSessions) {
    const entry = agentStore.get(s.sessionId);
    result.push({
      sessionId: s.sessionId,
      title: s.title ?? extractTitle(entry?.messages ?? []),
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : Date.now(),
      messageCount: entry?.messages.length ?? s.messageCount,
    });
  }

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
    sessionProvider.cueMessages(sessionId, entry.messages);
  } else if (chunk.type === 'error') {
    msg.status = 'error';
    msg.error = String(chunk.error);
    sessionProvider.cueMessages(sessionId, entry.messages);
  }
}

export function getSessionMessages(sessionId: string): ServerMessage[] {
  const entry = agentStore.get(sessionId);
  if (entry?.messages.length) return entry.messages;
  return (sessionProvider.pullMessages(sessionId) ?? []) as ServerMessage[];
}

export async function deleteSessionFromStore(sessionId: string): Promise<void> {
  agentStore.delete(sessionId);
  await sessionProvider.delete(sessionId);
}
