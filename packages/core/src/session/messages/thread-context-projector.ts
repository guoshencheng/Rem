import type { ImageContent, Message, TextContent, UserMessage } from '@earendil-works/pi-ai';
import type { ResolvedAgentRole } from '../../sdk/agent-role.js';
import type { AgentThread } from '../agent-thread/model.js';
import type { SessionTreeEntry } from '../tree/types.js';
import { getActiveEntryChain } from './entry-chain.js';
import type { MessageEntryPayload, NormalizedMessageEntryPayload } from './payload.js';
import { normalizeMessagePayload } from './normalize.js';

export interface ThreadContextProjectionInput {
  entries: SessionTreeEntry[];
  leafId: string | null;
  target: AgentThread;
  threads: AgentThread[];
  agents: ResolvedAgentRole[];
}

export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionError';
  }
}

export function projectThreadContext(input: ThreadContextProjectionInput): Message[] {
  const threadById = new Map(input.threads.map((thread) => [thread.agentThreadId, thread]));
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  requireTarget(input.target, threadById, agentById);
  const primaryThreadId = input.threads.find((thread) => thread.role === 'primary')?.agentThreadId
    ?? input.target.agentThreadId;

  return getActiveEntryChain(input.entries, input.leafId).flatMap((entry) => {
    if (entry.type !== 'message') return [];
    const payload = normalizeMessagePayload(entry.payload as MessageEntryPayload, primaryThreadId);
    return projectPayload(payload, input.target, threadById, agentById);
  });
}

function projectPayload(
  payload: NormalizedMessageEntryPayload,
  target: AgentThread,
  threads: Map<string, AgentThread>,
  agents: Map<string, ResolvedAgentRole>,
): Message[] {
  if (payload.author.type === 'user') {
    return payload.scope.type === 'session' ? [payload.message] : [];
  }
  const authorThreadId = payload.author.agentThreadId;
  if (authorThreadId === target.agentThreadId) return [payload.message];
  if (payload.scope.type !== 'session' || payload.author.type !== 'agent') return [];
  const authorThread = threads.get(authorThreadId);
  if (!authorThread) throw new ProjectionError(`agent thread not found: ${authorThreadId}`);
  const agent = agents.get(authorThread.agentId);
  if (!agent) throw new ProjectionError(`configured agent not found: ${authorThread.agentId}`);
  const converted = convertPublicAgentMessage(payload.message, agent.name);
  return converted ? [converted] : [];
}

function convertPublicAgentMessage(message: Message, name: string): UserMessage | null {
  if (message.role !== 'assistant') return null;
  const content = (message.content as unknown[]).filter(isSupportedPublicContent);
  if (content.length === 0) return null;
  return {
    role: 'user',
    content: [{ type: 'text', text: `[Agent: ${name}]` }, ...content],
    timestamp: message.timestamp,
  };
}

function isSupportedPublicContent(part: unknown): part is TextContent | ImageContent {
  if (!part || typeof part !== 'object' || !('type' in part)) return false;
  return part.type === 'text' || part.type === 'image';
}

function requireTarget(
  target: AgentThread,
  threads: Map<string, AgentThread>,
  agents: Map<string, ResolvedAgentRole>,
): void {
  if (!threads.has(target.agentThreadId)) {
    throw new ProjectionError(`target agent thread not found: ${target.agentThreadId}`);
  }
  if (!agents.has(target.agentId)) {
    throw new ProjectionError(`target configured agent not found: ${target.agentId}`);
  }
}
