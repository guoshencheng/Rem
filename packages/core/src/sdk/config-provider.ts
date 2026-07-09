import type { ToolPolicyConfig } from './tool-policy.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { ToolProfileId } from '../security/rules/profiles.js';
import type { Rule } from '../security/rules/rule.js';

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
  profile?: ToolProfileId;
  sessionRules?: Rule[];
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  models?: Record<string, AgentModelConfig>;
  activeModel?: string;
  model?: AgentModelConfig;
  toolPolicy?: ToolPolicyConfig;
  mcpServers?: Record<string, McpServerConfig>;
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
  getMcpConfig(): Record<string, McpServerConfig>;
}
