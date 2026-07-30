import type { ToolPolicyConfig } from './tool-policy.js';
import type { McpServerConfig } from '../mcp/types.js';
import type { ToolProfileId } from '../security/rules/profiles.js';
import type { Rule } from '../security/rules/rule.js';
import type { CustomAgentConfig, ResolvedAgentRole } from './agent-role.js';
import type { ThinkingLevel } from '@earendil-works/pi-ai';

export interface AgentModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  reasoning?: ThinkingLevel;
}

export interface AgentToolConfig {
  policy?: ToolPolicyConfig;
}

export interface CompressionConfig {
  enabled?: boolean;
  thresholdRatio?: number;
  protectHead?: number;
  protectTail?: number;
}

export interface AgentBehaviorConfig {
  name?: string;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  profile?: ToolProfileId;
  sessionRules?: Rule[];
  compression?: CompressionConfig;
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  models?: Record<string, AgentModelConfig>;
  activeModel?: string;
  model?: AgentModelConfig;
  toolPolicy?: ToolPolicyConfig;
  mcpServers?: Record<string, McpServerConfig>;
  agents?: Record<string, CustomAgentConfig>;
}

export interface ResolvedModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  reasoning?: ThinkingLevel;
}

export interface ResolvedAgentConfig extends Required<AgentBehaviorConfig>, AgentToolConfig {
  model: ResolvedModelConfig;
}

export interface ConfigProvider {
  /** 初始化/重新加载配置。实现必须保证幂等。 */
  init(): Promise<void>;
  getConfig(): ResolvedAgentConfig;
  getModelConfig(modelId?: string): ResolvedModelConfig;
  getToolConfig(): AgentToolConfig;
  getBehaviorConfig(): Required<AgentBehaviorConfig>;
  getCompressionConfig(): Required<CompressionConfig>;
  getMcpConfig(): Record<string, McpServerConfig>;
  resolveAgent(id?: string): ResolvedAgentRole;
  /** 返回指定 workspace 的配置视图（合并 workspace 级配置文件）；缺省时用自身 */
  forWorkspace?(workspace: string): ConfigProvider;
}
