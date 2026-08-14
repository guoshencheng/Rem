import type { JsonSchema } from '../json/types.js';

export interface AgentRef {
  agentId: string;
  revision?: string;
}

export interface OrchestrationLimits {
  maxAgentRuns: number;
  maxMessages: number;
  maxDepth: number;
  timeoutMs: number;
  maxTokens: number;
  maxParallelAgents: number;
}

export interface DelegationDefinition {
  enabled: boolean;
  maxDepth?: number;
}

export type ExecutionStrategyDefinition =
  | {
      type: 'single-agent';
      delegation?: DelegationDefinition;
    }
  | {
      type: 'team';
      members: readonly AgentRef[];
      limits?: Partial<OrchestrationLimits>;
      delegation?: DelegationDefinition;
    };

export interface AgentPlanParticipant {
  agentId: string;
  revision: string;
  role: 'root' | 'organizer' | 'member';
}

/** Immutable definition material needed to execute a participant after restart. */
export interface AgentPlanParticipantSnapshot extends AgentPlanParticipant {
  name: string;
  instructions: string;
  modelId: string;
  toolNames: readonly string[];
  acceptedTriggers: readonly ('message' | 'task')[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  delegation?: DelegationDefinition;
}

export interface ExecutionPlanSnapshot {
  orchestrationVersion?: 1;
  executionType: 'single-agent' | 'team';
  participants: readonly AgentPlanParticipant[];
  participantSnapshots: readonly AgentPlanParticipantSnapshot[];
  modelId: string;
  toolNames: readonly string[];
  instructions: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  limits: OrchestrationLimits;
  hash: string;
}

export const DEFAULT_ORCHESTRATION_LIMITS: OrchestrationLimits = {
  maxAgentRuns: 20,
  maxMessages: 50,
  maxDepth: 8,
  timeoutMs: 300_000,
  maxTokens: 200_000,
  maxParallelAgents: 4,
};
