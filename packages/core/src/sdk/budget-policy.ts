import type { AgentState } from '../state.js';

export interface BudgetStatus {
  turnsRemaining: number;
  consecutiveErrors: number;
  atRisk: boolean;
  reason?: string;
}

export interface BudgetPolicy {
  checkTurn(state: AgentState): boolean;
  checkTimeout(startTime: number): boolean;
  shouldCircuitBreak(state: AgentState): boolean;
  getStatus(state: AgentState): BudgetStatus;
}
