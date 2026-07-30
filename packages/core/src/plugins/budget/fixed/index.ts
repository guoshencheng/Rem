import type { BudgetPolicy, BudgetStatus } from '../../../sdk/budget-policy.js';
import type { AgentLiveState } from '../../../state.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';

export class FixedBudgetPolicy implements BudgetPolicy {
  private maxTurns: number;
  private timeoutMs: number;

  constructor(configProvider: ConfigProvider) {
    const behavior = configProvider.getBehaviorConfig();
    this.maxTurns = behavior.maxTurns;
    this.timeoutMs = 300_000;
  }

  checkTurn(liveState: AgentLiveState): boolean {
    return liveState.budget.hasBudget();
  }

  checkTimeout(startTime: number): boolean {
    return Date.now() - startTime < this.timeoutMs;
  }

  shouldCircuitBreak(): boolean {
    return false;
  }

  getStatus(liveState: AgentLiveState): BudgetStatus {
    const budgetStatus = liveState.budget.getStatus();
    const atRisk = budgetStatus.turnsRemaining <= 3;
    return {
      turnsRemaining: budgetStatus.turnsRemaining,
      consecutiveErrors: budgetStatus.consecutiveErrors,
      atRisk,
      reason: budgetStatus.turnsRemaining === 0 ? 'max_turns exceeded' : undefined,
    };
  }
}
