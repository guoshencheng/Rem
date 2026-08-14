import type { AgentDefinition, Message, Run, RunSignal, RuntimeSessionSummary, Session } from 'rem-agent-core';
import type {
  RunExecutionNode, RunExecutionEntry, RunDelivery, RuntimeToolInvocation,
} from 'rem-agent-core';
import { RuntimeClient } from 'rem-agent-client';
import type { RuntimeChatMessage, WorkbenchSession } from '@/types';
import type { RuntimeToolResult } from '@/state/runtime-stream-projection';

export const DEFAULT_AGENT_ID = 'web-agent';

const client = new RuntimeClient({ baseUrl: '' });
const activeRuns = new Map<string, string>();

export interface RuntimeChat {
  messages: RuntimeChatMessage[];
  toolResults: Record<string, RuntimeToolResult>;
}

export interface SendMessageObserver {
  onStarted?: (run: Run) => void;
  onSignal?: (signal: RunSignal) => void;
}

export interface RuntimeRunInspectorData {
  run: Run;
  nodes: RunExecutionNode[];
  entries: RunExecutionEntry[];
  deliveries: RunDelivery[];
  invocations: RuntimeToolInvocation[];
}

export function sessionInfo(
  session: RuntimeSessionSummary | Session,
  messageCount = 'messageCount' in session ? session.messageCount : 0,
): WorkbenchSession {
  return {
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    title: `Session ${session.sessionId.slice(0, 8)}`,
    updatedAt: session.updatedAt.getTime(),
    messageCount,
  };
}

export const api = {
  defaultAgentId: DEFAULT_AGENT_ID,
  listSessions: async (): Promise<WorkbenchSession[]> => {
    const sessions = await client.sessions.list();
    return sessions.map((session) => sessionInfo(session, session.messageCount));
  },

  listAgents: async (): Promise<AgentDefinition[]> => client.agents.list(),

  listRuns: async (sessionId: string): Promise<Run[]> => (
    await client.runs.list({ sessionId, limit: 50 })
  ).items,

  getRunInspector: async (runId: string): Promise<RuntimeRunInspectorData> => {
    const [run, nodes, entries, deliveries, invocations] = await Promise.all([
      client.runs.get(runId),
      client.runs.listExecutionNodes(runId),
      client.runs.listExecutionEntries(runId, { limit: 1000 }),
      client.runs.listDeliveries(runId),
      client.runs.listToolInvocations(runId),
    ]);
    return { run, nodes, entries, deliveries, invocations };
  },

  resolveToolInvocation: (
    runId: string,
    invocationId: string,
    resolution: import('rem-agent-core').ToolInvocationResolution,
  ) => client.runs.resolveToolInvocation(runId, invocationId, resolution),
  waitForRun: (runId: string) => client.runs.waitForCompletion(runId),

  createSession: async (): Promise<WorkbenchSession> => {
    const session = await client.sessions.create();
    return sessionInfo(session);
  },

  getChat: async (sessionId: string): Promise<RuntimeChat> => {
    const entries = await client.sessions.listEntries(sessionId);
    const toolResults: Record<string, RuntimeToolResult> = {};
    const messages = entries.flatMap((entry) => {
      if (entry.message.role === 'toolResult') {
        toolResults[entry.message.toolCallId] = projectToolResult(entry.message);
        return [];
      }
      if (entry.message.role !== 'user' && entry.message.role !== 'assistant') return [];
      return [{ messageId: entry.entryId, message: entry.message }];
    });
    return { messages, toolResults };
  },

  sendMessage: async (
    sessionId: string,
    content: string,
    agentOrObserver: string | SendMessageObserver = DEFAULT_AGENT_ID,
    observer?: SendMessageObserver,
  ): Promise<Run> => {
    const agentId = typeof agentOrObserver === 'string' ? agentOrObserver : DEFAULT_AGENT_ID;
    const sink = typeof agentOrObserver === 'string' ? observer : agentOrObserver;
    const idempotencyKey = `web:${sessionId}:${crypto.randomUUID()}`;
    const run = await client.runs.start({
      agentId,
      sessionId,
      idempotencyKey,
      trigger: { type: 'message', content },
    });
    activeRuns.set(sessionId, run.runId);
    try {
      sink?.onStarted?.(run);
      let reachedTerminal = false;
      try {
        for await (const signal of client.runs.subscribe(run.runId)) {
          sink?.onSignal?.(signal);
          reachedTerminal ||= signal.type === 'run.completed'
            || signal.type === 'run.failed' || signal.type === 'run.cancelled';
        }
      } catch {
        // The wait fallback below re-establishes observation after an early close.
      }
      const completed = reachedTerminal
        ? await client.runs.get(run.runId)
        : await client.runs.waitForCompletion(run.runId, { pollMs: 150 });
      if (completed.status === 'cancelled') return completed;
      if (completed.status !== 'completed') {
        throw new Error(`Run ${completed.status}${completed.errorCode ? `: ${completed.errorCode}` : ''}`);
      }
      return completed;
    } finally {
      if (activeRuns.get(sessionId) === run.runId) activeRuns.delete(sessionId);
    }
  },

  interrupt: async (sessionId: string): Promise<void> => {
    const runId = activeRuns.get(sessionId);
    if (runId) await client.runs.cancel(runId);
  },

};

function projectToolResult(message: Extract<Message, { role: 'toolResult' }>): RuntimeToolResult {
  const output = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  const details = message.details === undefined ? {} : { details: message.details };
  if (message.isError) return { error: output || '工具执行失败', ...details };
  return { output, ...details };
}
