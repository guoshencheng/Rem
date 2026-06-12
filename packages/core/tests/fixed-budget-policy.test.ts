import { describe, it, expect } from 'vitest';
import { FixedBudgetPolicy } from '../src/defaults/fixed-budget-policy.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

describe('FixedBudgetPolicy', () => {
  it('should allow turn when under max turns', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.currentTurn = 3;

    expect(policy.checkTurn(state)).toBe(true);
  });

  it('should deny turn when max turns reached', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.currentTurn = 5;

    expect(policy.checkTurn(state)).toBe(false);
  });

  it('should report atRisk when turns low', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.currentTurn = 3;

    const status = policy.getStatus(state);
    expect(status.atRisk).toBe(true);
    expect(status.turnsRemaining).toBe(2);
  });

  it('should check timeout', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5, timeoutMs: 1000 });
    const start = Date.now();

    expect(policy.checkTimeout(start)).toBe(true);
    expect(policy.checkTimeout(start - 2000)).toBe(false);
  });

  it('should not circuit break in P0', () => {
    const policy = new FixedBudgetPolicy({ maxTurns: 5 });
    const state = new AgentState();

    expect(policy.shouldCircuitBreak(state)).toBe(false);
  });
});
