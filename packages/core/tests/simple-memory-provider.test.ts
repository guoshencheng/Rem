import { describe, it, expect } from 'vitest';
import { SimpleMemoryProvider } from '../src/plugins/memory/simple/index.js';
import { AgentState } from '../src/state.js';
import { IterationBudget } from '../src/budget.js';

describe('SimpleMemoryProvider', () => {
  it('should build context with system prompt and conversation', async () => {
    const provider = new SimpleMemoryProvider('TestAgent');
    const state = new AgentState(undefined, new IterationBudget({ maxTurns: 5 }));
    state.addMessage({ role: 'user', content: 'Hello' });

    const ctx = await provider.buildContext(state);

    expect(ctx.systemPrompt).toBe('You are TestAgent.');
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].role).toBe('user');
  });

  it('should return empty messages for fresh state', async () => {
    const provider = new SimpleMemoryProvider('Agent');
    const state = new AgentState();

    const ctx = await provider.buildContext(state);

    expect(ctx.messages).toHaveLength(0);
  });
});
