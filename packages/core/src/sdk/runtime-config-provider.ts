import type { ThinkingLevel } from '@earendil-works/pi-ai';
import type { ToolPolicyConfig } from './tool-policy.js';

export interface RuntimeModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  reasoning?: ThinkingLevel;
}

export interface ResolvedRuntimeModelConfig extends RuntimeModelConfig {
  apiKey: string;
}

export interface RuntimeToolDefaults {
  policy?: ToolPolicyConfig;
}

export interface RuntimeCompressionDefaults {
  enabled: boolean;
  thresholdRatio: number;
  protectHead: number;
  protectTail: number;
}

export interface RuntimeOrchestrationDefaults {
  maxAgentRuns: number;
  maxMessages: number;
  maxDepth: number;
  timeoutMs: number;
  maxTokens: number;
  maxParallelAgents: number;
}

export interface RuntimeBehaviorDefaults {
  name: string;
  maxTurns: number;
  executionRoot: string;
  readOnly: boolean;
  autoApproveDangerous: boolean;
}

export interface RuntimeDefaults {
  config: Record<string, unknown>;
  behavior: RuntimeBehaviorDefaults;
  compression: RuntimeCompressionDefaults;
  tool: RuntimeToolDefaults;
  orchestration: RuntimeOrchestrationDefaults;
}

/** Runtime 执行所需的最小配置边界，不解析 Agent、Team 或外部工作区。 */
export interface RuntimeConfigProvider {
  init(): Promise<void>;
  getDefaults(): RuntimeDefaults;
  resolveModel(modelId: string): ResolvedRuntimeModelConfig;
}
