export type RunTriggerType = 'message' | 'task';

export type { AgentRef, DelegationDefinition, ExecutionStrategyDefinition, OrchestrationLimits } from './execution-types.js';
import type { ExecutionStrategyDefinition } from './execution-types.js';
import type { JsonSchema } from '../json/types.js';

export interface ContextTypeConstraint {
  type: string;
  min?: number;
  max?: number;
}

export interface AgentDefinition {
  agentId: string;
  revision: string;
  name: string;
  instructions: string;
  modelId: string;
  toolNames: readonly string[];
  acceptedTriggers: readonly RunTriggerType[];
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  requiredContexts?: readonly ContextTypeConstraint[];
  optionalContexts?: readonly ContextTypeConstraint[];
  overridableContexts?: readonly string[];
  execution: ExecutionStrategyDefinition;
}
