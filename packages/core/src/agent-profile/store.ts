import type { AgentProfile } from './model.js';

export interface AgentProfileStore {
  save(profile: AgentProfile): Promise<void>;
  get(agentProfileId: string): Promise<AgentProfile | null>;
  list(): Promise<AgentProfile[]>;
  delete(agentProfileId: string): Promise<void>;
}
