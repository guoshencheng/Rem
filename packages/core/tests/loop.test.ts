import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from '../src/loop.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import { createMockModelClient } from './mock-model-client.js';

describe('AgentLoop', () => {
  it('should execute a simple turn without tools', async () => {
    const modelClient = createMockModelClient({
      content: 'Hello!',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    });

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(modelClient, events);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are helpful',
      availableTools: [],
    }, state);

    expect(result.output.content).toBe('Hello!');
    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  it('should emit turn events', async () => {
    const modelClient = createMockModelClient({ content: 'OK' });
    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();

    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const loop = new AgentLoop(modelClient, events);
    await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: [],
    }, state);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should stop when budget is exhausted', async () => {
    const modelClient = createMockModelClient({ content: '...' });
    const state = new AgentState(new IterationBudget({ maxTurns: 1 }));
    state.budget.checkTurn(); // Use up the one turn
    const events = new EventBus();
    const loop = new AgentLoop(modelClient, events);

    const result = await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 2,
      conversation: [],
      systemPrompt: '',
      availableTools: [],
    }, state);

    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });
});
