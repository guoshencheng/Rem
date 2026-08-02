import { describe, expect, it } from 'vitest';
import { DiscussionBudget } from '../src/orchestration/discussion-budget.js';

const limits = { maxAgentRuns: 2, maxMessages: 3, maxDepth: 1, timeoutMs: 100,
  maxTokens: 10, maxParallelAgents: 2 };

describe('DiscussionBudget', () => {
  it('reserves runs atomically at the configured boundary', () => {
    const budget = new DiscussionBudget(limits);
    expect(budget.reserveRun(0)).toBeNull();
    expect(budget.reserveRun(1)).toBeNull();
    expect(budget.reserveRun(1)).toBe('agent-runs');
    budget.releaseRun();
    expect(budget.reserveRun(2)).toBe('depth');
  });

  it('checks message, timeout and token limits independently', () => {
    const messages = new DiscussionBudget(limits, 0);
    messages.recordMessage(); messages.recordMessage(); messages.recordMessage();
    expect(messages.check(undefined, 1)).toBe('messages');
    const timeout = new DiscussionBudget(limits, 0);
    expect(timeout.check(undefined, 100)).toBe('timeout');
    const tokens = new DiscussionBudget(limits, 100);
    tokens.recordTokens(10);
    expect(tokens.check(undefined, 101)).toBe('tokens');
  });
});
