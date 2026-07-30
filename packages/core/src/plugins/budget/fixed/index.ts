import type { BudgetPolicy } from '../../../sdk/budget-policy.js';
import type { ConfigProvider } from '../../../sdk/config-provider.js';

export class FixedBudgetPolicy implements BudgetPolicy {
  private timeoutMs = 300_000;

  constructor(_configProvider: ConfigProvider) {}

  checkTimeout(startTime: number): boolean {
    return Date.now() - startTime < this.timeoutMs;
  }
}
