import { describe, it, expect, vi } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { runAgent } from '../src/run-agent.js';
import { AgentState } from '../src/agent-state.js';
import { createFauxDi, stubRuntimeConfig } from './run-agent/faux-di.js';
import type { PromptBuildContext } from '../src/sdk/system-prompt.js';

describe('runAgent custom agent', () => {
  it('uses custom agent corePrompt and falls back to default model', async () => {
    const contexts: PromptBuildContext[] = [];
    const { di } = createFauxDi({
      responses: [fauxAssistantMessage('done')],
      configOverrides: {
        resolveAgent: () => ({ id: 'custom', name: 'custom-agent', corePrompt: 'CUSTOM PROMPT' }),
      },
      diOverrides: {
        systemPromptAssembler: { assemble: vi.fn(async (ctx: PromptBuildContext) => { contexts.push(ctx); return 'sys'; }) },
      },
    });

    const result = runAgent({
      input: { content: 'hi' },
      sessionId: 'custom-session',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
      agent: 'custom',
    });
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    const output = await result.output;

    expect(output.content).toBe('done');
    expect(contexts[0].agentName).toBe('custom-agent');
    expect(contexts[0].agentCorePrompt).toBe('CUSTOM PROMPT');
    expect(contexts[0].model).toEqual({ provider: 'faux', model: 'faux-1' });
  });

  it('uses custom agent model override', async () => {
    const contexts: PromptBuildContext[] = [];
    const { di } = createFauxDi({
      responses: [fauxAssistantMessage('done')],
      configOverrides: {
        getModelConfig: () => ({ provider: 'nonexistent', model: 'nope', apiKey: '', baseURL: undefined }),
        resolveAgent: () => ({
          id: 'custom', name: 'custom-agent', corePrompt: 'p',
          model: { provider: 'faux', model: 'faux-1', apiKey: '', baseURL: undefined },
        }),
      },
      diOverrides: {
        systemPromptAssembler: { assemble: vi.fn(async (ctx: PromptBuildContext) => { contexts.push(ctx); return 'sys'; }) },
      },
    });

    const result = runAgent({
      input: { content: 'hi' },
      sessionId: 'custom-model-session',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
      agent: 'custom',
    });
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    const output = await result.output;

    expect(output.content).toBe('done');
    expect(contexts[0].model).toEqual({ provider: 'faux', model: 'faux-1' });
  });

  it('falls back to default when agent is unknown', async () => {
    const contexts: PromptBuildContext[] = [];
    const { di } = createFauxDi({
      responses: [fauxAssistantMessage('done')],
      diOverrides: {
        systemPromptAssembler: { assemble: vi.fn(async (ctx: PromptBuildContext) => { contexts.push(ctx); return 'sys'; }) },
      },
    });

    const result = runAgent({
      input: { content: 'hi' },
      sessionId: 'unknown-agent-session',
      di, runtimeConfig: stubRuntimeConfig(),
      agentState: new AgentState(),
      agent: 'does-not-exist',
    });
    for await (const _chunk of result.stream.fullStream) {
      // drain
    }
    const output = await result.output;

    expect(output.content).toBe('done');
    expect(contexts[0].agentName).toBe('test');
  });
});
