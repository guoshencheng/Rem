import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { REMAgent, REMAgentParams } from '../agent/rem-agent.js';
import type { UserInputContent } from '../agent/types.js';
import type { SessionInfo } from '../session/manager/types.js';

export interface CreateSessionInput {
  workspace: string;
}

export interface SendMessageInput {
  sessionId: string;
  content: UserInputContent;
}

export type RootAgentFactory = (params: REMAgentParams) => REMAgent;

export interface CreateAgentSystemOptions {
  createRootAgent?: RootAgentFactory;
  delegation?: { maxDepth?: number };
}

export interface AgentSystem {
  createSession(input: CreateSessionInput): Promise<SessionInfo>;
  getSession(sessionId: string): Promise<SessionInfo>;
  listSessions(workspace: string): Promise<SessionInfo[]>;
  send(input: SendMessageInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent>;
}
