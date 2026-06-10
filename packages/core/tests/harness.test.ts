import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from '../src/harness.js';
import { IterationBudget } from '../src/budget.js';
import { createMockModelClient } from './mock-model-client.js';

describe('AgentHarness', () => {
  it('should initialize with idle status', () => {
    const harness = new AgentHarness({
      name: 'test-agent',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
    });
    expect(harness.status).toBe('idle');
  });

  it('should run a single turn and complete', async () => {
    const modelClient = createMockModelClient({
      content: 'Done!',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    });

    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      modelClient,
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await harness.initialize();
    const result = await harness.run({ content: 'Hello' });

    expect(result.content).toBe('Done!');
    expect(harness.status).toBe('idle');
  });

  it('should reset session state', async () => {
    const modelClient = createMockModelClient({ content: 'OK' });

    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      modelClient,
      budget: new IterationBudget({ maxTurns: 5 }),
    });

    await harness.initialize();
    await harness.run({ content: 'Hello' });
    expect(harness['state'].conversation.length).toBeGreaterThan(0);

    await harness.reset();
    expect(harness['state'].conversation).toHaveLength(0);
    expect(harness.status).toBe('idle');
  });

  it('should allow event subscription', async () => {
    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
    });

    const handler = vi.fn();
    harness.on('harness:init', handler);

    await harness.initialize();
    expect(handler).toHaveBeenCalled();
  });

  it('should handle interrupt', async () => {
    const modelClient = createMockModelClient({ content: 'Late response' });

    const harness = new AgentHarness({
      name: 'test',
      modelConfig: { provider: 'openai', model: 'gpt-4', apiKey: 'test' },
      modelClient,
    });

    await harness.initialize();
    const runPromise = harness.run({ content: 'Slow' });
    harness.interrupt();

    const result = await runPromise;
    expect(result.content).toContain('interrupted');
  });
});
