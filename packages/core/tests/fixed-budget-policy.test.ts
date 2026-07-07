import { describe, it, expect } from 'vitest';
import { FixedBudgetPolicy } from '../src/plugins/budget/fixed/index.js';
import { AgentLiveState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

describe('FixedBudgetPolicy', () => {
  it('should allow turn when under max turns', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const liveState = new AgentLiveState(new IterationBudget({ maxTurns: 5 }));

    expect(policy.checkTurn(liveState)).toBe(true);
  });

  it('should report turns remaining from budget', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const liveState = new AgentLiveState(new IterationBudget({ maxTurns: 5 }));

    const status = policy.getStatus(liveState);
    expect(status.turnsRemaining).toBeGreaterThan(0);
  });

  it('should check timeout', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5, timeoutMs: 1000 });
    const start = Date.now();

    expect(policy.checkTimeout(start)).toBe(true);
    expect(policy.checkTimeout(start - 2000)).toBe(false);
  });

  it('should not circuit break in P0', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });

    expect(policy.shouldCircuitBreak()).toBe(false);
  });

  it('should report atRisk when turns low', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 3 });
    const liveState = new AgentLiveState(new IterationBudget({ maxTurns: 3 }));

    const status = policy.getStatus(liveState);
    expect(status.atRisk).toBe(true);
  });
});
