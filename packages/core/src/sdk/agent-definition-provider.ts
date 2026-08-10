import type { AgentDefinition } from '../domain/agent-definition/types.js';

export interface AgentDefinitionProvider {
  init(): Promise<void>;
  get(agentId: string, revision?: string): Promise<AgentDefinition | null>;
  list(): Promise<AgentDefinition[]>;
}
