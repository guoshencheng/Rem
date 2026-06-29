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

type Agent = CoreAgent;
type RunResult = ReturnType<Agent['run']>;

interface AgentEntry {
  agent: Agent;
}

const sharedSessionProvider = new InMemorySessionProvider();
const sharedMemoryProvider = new SimpleMemoryProvider('Rem Agent');

const agentStore = new Map<string, AgentEntry>();
const activeStreams = new Map<string, { result: RunResult; abort: AbortController }>();

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
    entry = { agent };
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
