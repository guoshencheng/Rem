export type AgentThreadRole = 'primary' | 'organizer' | 'member' | 'delegated';
export type AgentThreadLifecycle = 'persistent' | 'one-shot';

export interface AgentThread {
  agentThreadId: string;
  sessionId: string;
  agentId: string;
  role: AgentThreadRole;
  lifecycle: AgentThreadLifecycle;
  createdAt: Date;
  updatedAt: Date;
}
