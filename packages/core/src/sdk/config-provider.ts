import type { ToolPolicyConfig } from './tool-policy.js';
import type { CustomAgentConfig, ResolvedAgentRole, ResolvedTeam } from './agent-role.js';
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
  compression?: CompressionConfig;
}

export interface TeamConfig {
  organizer: string;
  members: string[];
}

export interface TeamInfo {
  id: string;
  organizer: string;
  members: string[];
}

export interface OrchestrationConfig {
  maxAgentRuns?: number;
  maxMessages?: number;
  maxDepth?: number;
  timeoutMs?: number;
  maxTokens?: number;
  maxParallelAgents?: number;
}

export interface ResolvedOrchestrationConfig {
  maxAgentRuns: number;
  maxMessages: number;
  maxDepth: number;
  timeoutMs: number;
  maxTokens: number;
  maxParallelAgents: number;
}

export interface AgentConfig extends AgentBehaviorConfig, AgentToolConfig {
  models?: Record<string, AgentModelConfig>;
  activeModel?: string;
  model?: AgentModelConfig;
  toolPolicy?: ToolPolicyConfig;
  agents?: Record<string, CustomAgentConfig>;
  teams?: Record<string, TeamConfig>;
  orchestration?: OrchestrationConfig;
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
  /** Omitted resolves the configured default; an explicit ID must name cfg.models own entry. */
  getModelConfig(modelId?: string): ResolvedModelConfig;
  getToolConfig(): AgentToolConfig;
  getBehaviorConfig(): Required<AgentBehaviorConfig>;
  getCompressionConfig(): Required<CompressionConfig>;
  resolveAgent(id?: string): ResolvedAgentRole;
  resolveTeam(id: string): ResolvedTeam;
  listTeams(): TeamInfo[];
  getOrchestrationConfig(): ResolvedOrchestrationConfig;
  /** 返回指定 workspace 的配置视图（合并 workspace 级配置文件）；缺省时用自身 */
  forWorkspace?(workspace: string): ConfigProvider;
}
