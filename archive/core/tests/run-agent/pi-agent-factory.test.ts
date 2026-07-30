import { describe, it, expect } from 'vitest';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { AgentEvent, AgentTool } from '@earendil-works/pi-agent-core';
import { createPiAgent } from '../../src/run-agent/pi-agent-factory.js';
import { createCoreModels } from '../../src/llm/models.js';
import type { AgentDI } from '../../src/agent-di.js';

const setup = (responses: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]) => {
  const handle = fauxProvider();
  handle.setResponses(responses);
  const models = createCoreModels({ customProviders: [handle.provider] });
  return { handle, models };
};

const factoryParams = (models: ReturnType<typeof createCoreModels>, overrides: Record<string, unknown> = {}) => ({
  di: { models } as AgentDI,
  effectiveModel: { provider: 'faux', model: 'faux-1', apiKey: '', baseURL: undefined, reasoning: undefined },
  systemPrompt: 'sys',
  messages: [],
  tools: [] as AgentTool[],
  beforeToolCall: async () => undefined,
  transformContext: async (m: never[]) => m,
  maxTurns: 10,
  ...overrides,
});

describe('createPiAgent', () => {
  it('runs a prompt to completion with the faux provider', async () => {
    const { models } = setup([fauxAssistantMessage('hello')]);
    const agent = createPiAgent(factoryParams(models) as never);
    const events: string[] = [];
    agent.subscribe((e: AgentEvent) => { events.push(e.type); });
    await agent.prompt('hi');
    expect(events).toContain('agent_start');
    expect(events).toContain('message_end');
    expect(events[events.length - 1]).toBe('agent_end');
  });

  it('aborts after maxTurns when the model keeps requesting tools', async () => {
    const echo: AgentTool = {
      name: 'echo', description: 'd', label: 'echo',
      parameters: { type: 'object', properties: {} } as never,
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: undefined }),
    };
    const { models } = setup([
      () => fauxAssistantMessage([fauxToolCall('echo', {})], { stopReason: 'toolUse' }),
    ]);
    const agent = createPiAgent(factoryParams(models, { tools: [echo], maxTurns: 2 }) as never);
    await agent.prompt('go');
    const turns = agent.state.messages.filter((m) => m.role === 'assistant').length;
    expect(turns).toBeLessThanOrEqual(3);
  });
});
