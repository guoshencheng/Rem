import type { AgentModelConfig, ResolvedModelConfig } from './config-provider.js';

export interface CustomAgentConfig {
  name: string;
  corePrompt: string;
  model?: AgentModelConfig;
}

export interface ResolvedAgentRole {
  id: string;
  name: string;
  corePrompt: string;
  model?: ResolvedModelConfig;
}

export interface ResolvedTeam {
  id: string;
  organizer: ResolvedAgentRole;
  members: ResolvedAgentRole[];
}

export interface AgentResolver {
  resolveAgent(id?: string): ResolvedAgentRole;
}
