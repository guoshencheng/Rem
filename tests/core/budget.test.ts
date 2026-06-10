import { describe, it, expect } from 'vitest';
import { IterationBudget } from '../../src/core/budget.js';

describe('IterationBudget', () => {
  it('should allow turns within budget', () => {
    const budget = new IterationBudget({ maxTurns: 3 });
    expect(budget.checkTurn()).toBe(true);
    expect(budget.checkTurn()).toBe(true);
    expect(budget.checkTurn()).toBe(true);
  });

  it('should deny turns when maxTurns exceeded', () => {
    const budget = new IterationBudget({ maxTurns: 2 });
    budget.checkTurn();
    budget.checkTurn();
    expect(budget.checkTurn()).toBe(false);
    expect(budget.getStatus().reason).toBe('max_turns exceeded');
  });

  it('should track consecutive errors', () => {
    const budget = new IterationBudget({ maxConsecutiveErrors: 2 });
    budget.recordError();
    expect(budget.hasBudget()).toBe(true);
    budget.recordError();
    expect(budget.hasBudget()).toBe(false);
  });

  it('should reset consecutive errors on success', () => {
    const budget = new IterationBudget({ maxConsecutiveErrors: 2 });
    budget.recordError();
    budget.recordSuccess();
    budget.recordError();
    expect(budget.hasBudget()).toBe(true);
  });

  it('should track same-tool failures', () => {
    const budget = new IterationBudget({ maxSameToolFailures: 2 });
    budget.recordError('tool:a');
    budget.recordError('tool:a');
    expect(budget.hasBudget()).toBe(false);
  });

  it('should report at-risk status', () => {
    const budget = new IterationBudget({ maxTurns: 10 });
    for (let i = 0; i < 8; i++) budget.checkTurn();
    const status = budget.getStatus();
    expect(status.atRisk).toBe(true);
    expect(status.turnsRemaining).toBe(2);
  });
});
