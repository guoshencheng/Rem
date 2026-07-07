import type { BudgetPolicy, BudgetStatus } from '../../../sdk/budget-policy.js';
import type { AgentLiveState } from '../../../state.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface FixedBudgetConfig {
  maxTurns: number;
  timeoutMs?: number;
}

export class FixedBudgetPolicy implements BudgetPolicy {
  private maxTurns: number;
  private timeoutMs: number;

  constructor(config: FixedBudgetConfig) {
    this.maxTurns = config.maxTurns;
    this.timeoutMs = config.timeoutMs ?? 300_000;
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

export function createProvider(config: FixedBudgetConfig | undefined): FixedBudgetPolicy {
  if (!config) {
    throw new Error('FixedBudgetPolicy requires maxTurns');
  }
  return new FixedBudgetPolicy(config);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): FixedBudgetConfig {
  return { maxTurns: ctx.maxTurns };
}
