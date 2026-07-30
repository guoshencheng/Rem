import type { BudgetStatus } from './sdk/budget-policy.js';

export interface BudgetConfig {
  maxTurns: number;
  maxConsecutiveErrors: number;
  maxSameToolFailures: number;
}

export { type BudgetStatus } from './sdk/budget-policy.js';

export class IterationBudget {
  private config: BudgetConfig;
  turnCount = 0;
  consecutiveErrors = 0;
  sameToolFailures = new Map<string, number>();

  constructor(config: Partial<BudgetConfig>) {
    this.config = {
      maxTurns: config.maxTurns ?? Infinity,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
      maxSameToolFailures: config.maxSameToolFailures ?? 5,
    };
  }

  checkTurn(): boolean {
    if (this.turnCount >= this.config.maxTurns) return false;
    this.turnCount++;
    return true;
  }

  hasBudget(): boolean {
    if (this.turnCount >= this.config.maxTurns) return false;
    if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) return false;
    for (const count of this.sameToolFailures.values()) {
      if (count >= this.config.maxSameToolFailures) return false;
    }
    return true;
  }

  recordError(toolName?: string): void {
    this.consecutiveErrors++;
    if (toolName) {
      const current = this.sameToolFailures.get(toolName) ?? 0;
      this.sameToolFailures.set(toolName, current + 1);
    }
  }

  recordSuccess(toolName?: string): void {
    this.consecutiveErrors = 0;
    if (toolName) this.sameToolFailures.delete(toolName);
  }

  getStatus(): BudgetStatus {
    const turnsRemaining = Math.max(0, this.config.maxTurns - this.turnCount);
    const atRisk = turnsRemaining <= 3 || this.consecutiveErrors >= this.config.maxConsecutiveErrors - 1;
    let reason: string | undefined;
    if (this.turnCount >= this.config.maxTurns) reason = 'max_turns exceeded';
    else if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) reason = 'max_consecutive_errors exceeded';
    return { turnsRemaining, consecutiveErrors: this.consecutiveErrors, atRisk, reason };
  }
}
