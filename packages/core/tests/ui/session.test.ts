import { describe, it, expect, vi } from 'vitest';
import { CoreAgent } from '../../src/core-agent.js';
import { createUIAgentSession } from '../../src/ui/session.js';
import { IterationBudget } from '../../src/budget.js';

describe('createUIAgentSession', () => {
  it('returns a UIAgentSession', () => {
    const agent = new CoreAgent({ name: 'Test', budget: new IterationBudget({ maxTurns: 10 }) });
    const session = createUIAgentSession(agent);
    expect(session.maxTurns).toBe(10);
    expect(typeof session.submit).toBe('function');
    expect(typeof session.interrupt).toBe('function');
    expect(typeof session.reset).toBe('function');
  });
});
