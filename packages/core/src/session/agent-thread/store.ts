import type { AgentThread } from './model.js';

export interface AgentThreadStore {
  save(thread: AgentThread): Promise<void>;
  get(agentThreadId: string): Promise<AgentThread | null>;
  listBySession(sessionId: string): Promise<AgentThread[]>;
  delete(agentThreadId: string): Promise<void>;
}
