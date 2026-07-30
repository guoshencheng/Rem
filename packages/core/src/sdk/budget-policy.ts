export interface BudgetStatus {
  turnsRemaining: number;
  consecutiveErrors: number;
  atRisk: boolean;
  reason?: string;
}

export interface BudgetPolicy {
  checkTimeout(startTime: number): boolean;
}
