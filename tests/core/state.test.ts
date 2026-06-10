import { describe, it, expect } from 'vitest';
import { AgentState } from '../../src/core/state.js';
import { IterationBudget } from '../../src/core/budget.js';

describe('AgentState', () => {
  it('should initialize with idle status', () => {
    const state = new AgentState();
    expect(state.status).toBe('idle');
    expect(state.conversation).toHaveLength(0);
    expect(state.currentTurn).toBe(0);
  });

  it('should add messages', () => {
    const state = new AgentState();
    state.addMessage({ role: 'user', content: 'hello', timestamp: new Date() });
    expect(state.conversation).toHaveLength(1);
    expect(state.conversation[0].role).toBe('user');
  });

  it('should track tool calls', () => {
    const state = new AgentState();
    state.addToolCall({
      id: '1', name: 'test', arguments: {},
      durationMs: 100, timestamp: new Date(),
    });
    expect(state.toolCalls).toHaveLength(1);
  });

  it('should report canContinue when budget allows', () => {
    const state = new AgentState();
    state.status = 'running';
    expect(state.canContinue()).toBe(true);
  });

  it('should deny canContinue when status is error', () => {
    const state = new AgentState();
    state.status = 'error';
    expect(state.canContinue()).toBe(false);
  });

  it('should generate unique session IDs', () => {
    const a = new AgentState();
    const b = new AgentState();
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
