import {
  CoreAgent,
  IterationBudget,
  InMemorySessionProvider,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  FileSkillProvider,
  NoOpCompressor,
  SimpleErrorHandler,
  FixedBudgetPolicy,
} from 'rem-agent-core';
import type { AgentStreamChunk } from 'rem-agent-core';

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
};

if (!g._remAgentStore) g._remAgentStore = new Map();
if (!g._remActiveStreams) g._remActiveStreams = new Map();

const agentStore = g._remAgentStore;
const activeStreams = g._remActiveStreams;

let sharedSessionProvider: InMemorySessionProvider;
let sharedMemoryProvider: SimpleMemoryProvider;

function getSharedProviders() {
  if (!sharedSessionProvider) {
    sharedSessionProvider = new InMemorySessionProvider();
    sharedMemoryProvider = new SimpleMemoryProvider('Rem Agent');
  }
  return { sharedSessionProvider, sharedMemoryProvider };
}

export async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  let entry = agentStore.get(sessionId);
  if (!entry) {
    const { sharedSessionProvider: sp, sharedMemoryProvider: mp } = getSharedProviders();
    const agent = new CoreAgent({
      name: 'Rem Agent',
      budget: new IterationBudget({ maxTurns: 60 }),
      provider: 'openai',
      sessionProvider: sp,
      memoryProvider: mp,
      toolProvider: new InMemoryToolProvider(),
      skillProvider: new FileSkillProvider(),
      compressor: new NoOpCompressor(),
      errorHandler: new SimpleErrorHandler(),
      budgetPolicy: new FixedBudgetPolicy({ maxTurns: 60 }),
    });
    await agent.ready();
    await agent.initialize({ sessionId });
    entry = { agent, messages: [], assistantMsgId: '' };
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

export async function listAgentSessions(): Promise<Array<{ sessionId: string; title?: string; updatedAt: Date; messageCount: number }>> {
  const firstEntry = agentStore.values().next().value;
  if (!firstEntry) return [];
  return firstEntry.agent.listSessions();
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
  } else if (chunk.type === 'error') {
    msg.status = 'error';
    msg.error = String(chunk.error);
  }
}

export function getSessionMessages(sessionId: string): ServerMessage[] {
  return agentStore.get(sessionId)?.messages ?? [];
}
