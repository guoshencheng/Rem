import { describe, it, expect } from 'vitest';
import { AgentLiveState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

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
});
