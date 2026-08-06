import type { TeamInfo } from '../sdk/config-provider.js';
import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { REMAgent, REMAgentParams } from '../agent/rem-agent.js';
import type { UserInputContent } from '../agent/types.js';
import type { SessionInfo } from '../session/manager/types.js';
import type { AgentThread } from '../session/agent-thread/model.js';
import type { SessionChatMessage } from '../session/messages/session-chat-projector.js';
import type { Message } from '@earendil-works/pi-ai';

export interface CreateSessionInput {
  workspace: string;
  teamId?: string;
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
  listTeams(): Promise<TeamInfo[]>;
  getSessionThreads(sessionId: string): Promise<AgentThread[]>;
  getSessionChat(sessionId: string): Promise<SessionChatMessage[]>;
  getAgentThreadContext(sessionId: string, agentThreadId: string): Promise<Message[]>;
  send(input: SendMessageInput): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent>;
}
