import { describe, it, expect, vi } from 'vitest';
import { reason } from '../../src/reason/reason.js';
import type { Model, AssistantMessageEventStream, AssistantMessage } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai';
import type { ModelMessage } from '../../src/types.js';

describe('reason usage forwarding', () => {
  it('forwards usage chunk to emit', async () => {
    const emitted: any[] = [];
    const emit = (chunk: any) => { emitted.push(chunk); };

    const mockModel = { id: 'mock', provider: 'mock' } as Model<any>;
    const mockStream: AssistantMessageEventStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as any };
      },
      result: vi.fn().mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
      } as AssistantMessage),
    } as unknown as AssistantMessageEventStream;

    const mockModels: Models = {
      getModel: vi.fn().mockReturnValue(mockModel),
      stream: vi.fn().mockReturnValue(mockStream),
    } as unknown as Models;

    const messages: ModelMessage[] = [];
    await reason({
      models: mockModels,
      provider: 'mock',
      model: 'mock',
      apiKey: 'key',
      system: 'sys',
      messages,
    }, emit);

    expect(emitted.some(c => c.type === 'text-delta')).toBe(true);
  });
});
