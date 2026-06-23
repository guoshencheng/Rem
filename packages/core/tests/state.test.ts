import { describe, it, expect } from 'vitest';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';
import { InMemorySessionProvider } from '../src/plugins/session/in-memory/index.js';
import type { ModelMessage } from '../src/types.js';

describe('AgentState', () => {
  it('should create with a new session when none provided', () => {
    const state = new AgentState();
    expect(state.sessionId).toBeDefined();
    expect(state.conversation).toEqual([]);
    expect(state.currentTurn).toBe(0);
  });

  it('should wrap an existing session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    const state = new AgentState(session);
    expect(state.sessionId).toBe(session.sessionId);
    expect(state.conversation).toBe(session.conversation);
  });

  it('should delegate conversation mutations to session', async () => {
    const provider = new InMemorySessionProvider();
    const session = await provider.create();
    const state = new AgentState(session);

    state.addMessage({ role: 'user', content: 'hi' } as ModelMessage);
    expect(session.conversation).toHaveLength(1);
    expect(state.conversation[0].content).toBe('hi');
  });

  it('should reset session conversation', () => {
    const state = new AgentState();
    state.addMessage({ role: 'user', content: 'hi' } as ModelMessage);
    state.reset();
    expect(state.conversation).toHaveLength(0);
    expect(state.currentTurn).toBe(0);
    expect(state.status).toBe('idle');
  });

  it('should restore original maxTurns on reset', () => {
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.budget.checkTurn(); // consume one turn
    state.reset();
    expect(state.budget.getStatus().turnsRemaining).toBe(5);
  });

  it('should not continue when status is not running', () => {
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.status = 'idle';
    expect(state.canContinue()).toBe(false);
  });
});
