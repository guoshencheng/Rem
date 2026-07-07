import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultReasonProvider } from '../../../../src/plugins/reason/default/index.js';
import { registerProvider, clearProviders } from '../../../../src/llm/api-registry.js';
import type { ReasonParams } from '../../../../src/sdk/reason-provider.js';
import type { LLMProvider, StreamChunk } from '../../../../src/llm/types.js';

describe('DefaultReasonProvider', () => {
  beforeEach(() => {
    clearProviders();
    registerProvider('mock', {
      stream: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', text: 'hello' };
        yield { type: 'finish', reason: 'stop' };
      }) as LLMProvider['stream'],
      generate: vi.fn(),
    });
  });

  afterEach(() => {
    clearProviders();
  });

  it('aggregates text output and emits chunks', async () => {
    const errorHandler = {
      classify: () => 'unknown' as const,
      isRetryable: () => false,
    };

    const provider = new DefaultReasonProvider({ errorHandler });

    const params: ReasonParams = {
      provider: 'mock',
      model: 'mock-model',
      apiKey: 'test-key',
      messages: [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    };

    const chunks: unknown[] = [];
    const result = await provider.reason(params, {}, (c) => { chunks.push(c); });

    expect(result.text).toBe('hello');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
    expect(chunks.length).toBeGreaterThan(0);
  });
});
