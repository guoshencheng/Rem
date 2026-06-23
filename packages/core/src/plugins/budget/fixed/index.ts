import type { BudgetPolicy, BudgetStatus } from '../../../sdk/budget-policy.js';
import type { AgentState } from '../../../state.js';
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

  checkTurn(state: AgentState): boolean {
    return state.currentTurn < this.maxTurns;
  }

  checkTimeout(startTime: number): boolean {
    return Date.now() - startTime < this.timeoutMs;
  }

  shouldCircuitBreak(): boolean {
    return false;
  }

  getStatus(state: AgentState): BudgetStatus {
    const turnsRemaining = Math.max(0, this.maxTurns - state.currentTurn);
    const atRisk = turnsRemaining <= 3;
    return {
      turnsRemaining,
      consecutiveErrors: 0,
      atRisk,
      reason: turnsRemaining === 0 ? 'max_turns exceeded' : undefined,
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
