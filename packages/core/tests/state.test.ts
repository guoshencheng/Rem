import { describe, it, expect } from 'vitest';
import { AgentLiveState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';
import type { LanguageModelUsage } from '../src/types.js';

describe('AgentLiveState', () => {
  it('should have idle status by default', () => {
    const liveState = new AgentLiveState();
    expect(liveState.status).toBe('idle');
    expect(liveState.budget).toBeDefined();
  });

  it('should transition idle → running → idle via state machine', () => {
    const liveState = new AgentLiveState();
    liveState.start();
    expect(liveState.status).toBe('running');

    liveState.finish();
    expect(liveState.status).toBe('idle');
  });

  it('should transition running → error via fail()', () => {
    const liveState = new AgentLiveState();
    liveState.start();
    liveState.fail();
    expect(liveState.status).toBe('error');
  });

  it('should throw when starting from non-idle', () => {
    const liveState = new AgentLiveState();
    liveState.start();
    expect(() => liveState.start()).toThrow('"running"');
  });

  it('should throw when finishing from non-running', () => {
    const liveState = new AgentLiveState();
    expect(() => liveState.finish()).toThrow('"idle"');
  });

  it('should reset to idle with fresh budget', () => {
    const liveState = new AgentLiveState(new IterationBudget({ maxTurns: 5 }));
    const originalRemaining = liveState.budget.getStatus().turnsRemaining;
    liveState.reset();
    expect(liveState.status).toBe('idle');
    expect(liveState.budget.getStatus().turnsRemaining).toBe(originalRemaining);
  });

  it('should not continue when status is not running', () => {
    const liveState = new AgentLiveState(new IterationBudget({ maxTurns: 5 }));
    expect(liveState.canContinue()).toBe(false); // idle
  });

  it('should continue when running with budget', () => {
    const liveState = new AgentLiveState(new IterationBudget({ maxTurns: 5 }));
    liveState.start();
    expect(liveState.canContinue()).toBe(true);
  });

  it('starts with empty token usage', () => {
    const liveState = new AgentLiveState();
    expect(liveState.tokenUsage.totalTokens).toBe(0);
  });

  it('accumulates token usage', () => {
    const liveState = new AgentLiveState();
    const usage: LanguageModelUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: { noCacheTokens: 80, cacheReadTokens: 15, cacheWriteTokens: 5 },
      outputTokenDetails: { textTokens: 40, reasoningTokens: 10 },
    };
    liveState.addTokenUsage(usage);
    expect(liveState.tokenUsage.totalTokens).toBe(150);
    liveState.addTokenUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(liveState.tokenUsage.totalTokens).toBe(165);
  });
});
