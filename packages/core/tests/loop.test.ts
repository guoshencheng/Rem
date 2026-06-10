import { describe, it, expect, vi } from 'vitest';
import { AgentLoop } from '../src/loop.js';
import { AgentState } from '../src/state.js';
import { EventBus } from '../src/events.js';
import { IterationBudget } from '../src/budget.js';
import * as ai from 'ai';

vi.mock('ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('ai')>();
  return {
    ...mod,
    generateText: vi.fn(),
  };
});

function mockGenerateTextResponse(text: string): any {
  return {
    text,
    toolCalls: [],
    toolResults: [],
    usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 5, reasoningTokens: 0 } },
    finishReason: 'stop',
    rawFinishReason: 'stop',
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    staticToolResults: [],
    dynamicToolResults: [],
    totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 5, reasoningTokens: 0 } },
    warnings: [],
    response: { id: 'test', timestamp: new Date(), modelId: 'test' },
    request: {},
    providerMetadata: {},
    logprobs: undefined,
    textDelta: '',
    content: [],
  };
}

const createMockModel = (): any => ({ provider: 'test', modelId: 'test-model' });

describe('AgentLoop', () => {
  it('should execute a simple turn without tools', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('Hello!'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events);

    const result = await loop.executeTurn({
      input: { content: 'Hi' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: 'You are helpful',
      availableTools: {},
    }, state);

    expect(result.output.content).toBe('Hello!');
    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  it('should emit turn events', async () => {
    vi.mocked(ai.generateText).mockResolvedValueOnce(mockGenerateTextResponse('OK'));

    const state = new AgentState(new IterationBudget({ maxTurns: 5 }));
    const events = new EventBus();
    const beforeHandler = vi.fn();
    const afterHandler = vi.fn();

    events.on('turn:before', beforeHandler);
    events.on('turn:after', afterHandler);

    const loop = new AgentLoop(createMockModel(), events);
    await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 1,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
    }, state);

    expect(beforeHandler).toHaveBeenCalled();
    expect(afterHandler).toHaveBeenCalled();
  });

  it('should stop when budget is exhausted', async () => {
    const state = new AgentState(new IterationBudget({ maxTurns: 1 }));
    state.budget.checkTurn(); // Use up the one turn
    const events = new EventBus();
    const loop = new AgentLoop(createMockModel(), events);

    const result = await loop.executeTurn({
      input: { content: 'test' },
      turnNumber: 2,
      conversation: [],
      systemPrompt: '',
      availableTools: {},
    }, state);

    expect(result.completed).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });
});
