import type { ResolvedOrchestrationConfig } from '../sdk/config-provider.js';

export interface DiscussionBudgetState {
  agentRuns: number;
  messages: number;
  maxDepthReached: number;
  tokens: number;
}

export function createDiscussionBudget(
  config: ResolvedOrchestrationConfig,
): DiscussionBudgetState & { readonly limits: ResolvedOrchestrationConfig } {
  return { agentRuns: 0, messages: 0, maxDepthReached: 0, tokens: 0, limits: config };
}
