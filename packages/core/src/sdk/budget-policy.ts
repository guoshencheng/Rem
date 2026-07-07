import type { AgentLiveState } from '../state.js';

export interface BudgetStatus {
  turnsRemaining: number;
  consecutiveErrors: number;
  atRisk: boolean;
  reason?: string;
}

export interface BudgetPolicy {
  checkTurn(liveState: AgentLiveState): boolean;
  checkTimeout(startTime: number): boolean;
  shouldCircuitBreak(liveState: AgentLiveState): boolean;
  getStatus(liveState: AgentLiveState): BudgetStatus;
}
