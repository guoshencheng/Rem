import type { ToolPolicyConfig } from './tool-policy.js';

export interface AgentModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
}

export interface AgentToolConfig {
  policy?: ToolPolicyConfig;
}

export interface AgentBehaviorConfig {
  name?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  sessionsDir?: string;
  skillsDir?: string;
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  models?: Record<string, AgentModelConfig>;
  activeModel?: string;
  model?: AgentModelConfig;
  toolPolicy?: ToolPolicyConfig;
}

export interface ResolvedModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
}

export interface ResolvedAgentConfig extends Required<AgentBehaviorConfig>, AgentToolConfig {
  model: ResolvedModelConfig;
}

export interface ConfigProvider {
  getConfig(): ResolvedAgentConfig;
  getModelConfig(modelId?: string): ResolvedModelConfig;
  getToolConfig(): AgentToolConfig;
  getBehaviorConfig(): Required<AgentBehaviorConfig>;
}
