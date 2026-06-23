import { describe, it, expect, vi } from 'vitest';
import { CoreAgent } from '../../src/core-agent.js';
import { createUIAgentSession } from '../../src/ui/session.js';
import { IterationBudget } from '../../src/budget.js';

function createTestAgent(maxTurns: number): CoreAgent {
  return new CoreAgent({
    name: 'Test',
    budget: new IterationBudget({ maxTurns }),
    providerConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
  });
}

describe('createUIAgentSession', () => {
  it('returns a UIAgentSession', () => {
    const agent = createTestAgent(10);
    const session = createUIAgentSession(agent);
    expect(session.maxTurns).toBe(10);
    expect(typeof session.submit).toBe('function');
    expect(typeof session.interrupt).toBe('function');
    expect(typeof session.reset).toBe('function');
  });

  it('calls onStart and onStatusChange when agent starts', async () => {
    const agent = createTestAgent(0);
    await agent.initialize();

    const onStart = vi.fn();
    const onStatusChange = vi.fn();
    const session = createUIAgentSession(agent);
    session.setCallbacks({ onStart, onStatusChange });

    session.submit('hi');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onStart).toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith('running');
  });

  it('calls interrupt on the agent', () => {
    const agent = createTestAgent(10);
    const interruptSpy = vi.spyOn(agent, 'interrupt');
    const session = createUIAgentSession(agent);
    session.interrupt();
    expect(interruptSpy).toHaveBeenCalled();
  });
});
