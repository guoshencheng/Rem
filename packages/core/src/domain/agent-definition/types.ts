export type RunTriggerType = 'message' | 'task';

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
  requiredContexts?: readonly ContextTypeConstraint[];
  optionalContexts?: readonly ContextTypeConstraint[];
  overridableContexts?: readonly string[];
  execution: { type: 'single-agent' };
}
