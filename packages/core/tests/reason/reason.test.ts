import { describe, it, expect, vi } from 'vitest';
import { reason } from '../../src/reason/reason.js';
import * as apiRegistry from '../../src/llm/api-registry.js';
import type { LLMProvider, StreamChunk } from '../../src/llm/types.js';
import type { ModelMessage } from '../../src/types.js';

describe('reason usage forwarding', () => {
  it('forwards usage chunk to emit', async () => {
    const emitted: any[] = [];
    const emit = (chunk: any) => { emitted.push(chunk); };

    const mockProvider: LLMProvider = {
      async *stream() {
        yield { type: 'text', text: 'hello' };
        yield { type: 'usage', inputTokens: 10, outputTokens: 5, totalTokens: 15 };
      },
      async generate() {
        throw new Error('not used');
      },
    };

    vi.spyOn(apiRegistry, 'resolveProvider').mockReturnValue(mockProvider);

    const messages: ModelMessage[] = [];
    await reason({
      provider: 'mock',
      model: 'mock',
      apiKey: 'key',
      system: 'sys',
      messages,
    }, emit);

    const usageChunk = emitted.find(c => c.type === 'usage');
    expect(usageChunk).toBeDefined();
    expect(usageChunk.totalTokens).toBe(15);
  });
});
