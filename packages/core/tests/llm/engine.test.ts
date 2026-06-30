import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InferenceEngine } from '../../src/llm/engine.js';
import { registerProvider, clearProviders, resolveProvider } from '../../src/llm/api-registry.js';

function createStream(
  chunks: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }>,
): AsyncIterable<any> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

describe('InferenceEngine', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('should infer using raw stream', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const provider = resolveProvider('mock');
    const rawStream = provider.stream({ model: 'model', apiKey: 'key', messages: [{ role: 'user', content: 'Hi' }] });

    const engine = new InferenceEngine();
    const result = await engine.infer({
      messages: [{ role: 'user', content: 'Hi' }],
      stream: rawStream,
    });

    expect(result.text).toBe('Hello');
    expect(result.usage.totalTokens).toBe(2);
  });

  it('should call onChunk for each chunk', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'A' };
        yield { type: 'text', text: 'B' };
      },
    });

    const onChunk = vi.fn();
    const provider = resolveProvider('mock');
    const rawStream = provider.stream({ model: 'model', apiKey: 'key', messages: [] });

    const engine = new InferenceEngine();
    await engine.infer({
      messages: [],
      stream: rawStream,
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledTimes(2);
  });

  it('should strip thinking tags from collected text', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello <think>internal reasoning</think>world' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const provider = resolveProvider('mock');
    const rawStream = provider.stream({ model: 'model', apiKey: 'key', messages: [{ role: 'user', content: 'Hi' }] });

    const engine = new InferenceEngine();
    const result = await engine.infer({
      messages: [{ role: 'user', content: 'Hi' }],
      stream: rawStream,
    });

    expect(result.text).toBe('Hello world');
  });

  it('should partition thinking tags into reasoning chunks during streaming', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: 'Hello <think>internal' };
        yield { type: 'text', text: ' reasoning</think>world' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
      },
    });

    const chunks: Array<{ type: string; text?: string }> = [];
    const provider = resolveProvider('mock');
    const rawStream = provider.stream({ model: 'model', apiKey: 'key', messages: [{ role: 'user', content: 'Hi' }] });

    const engine = new InferenceEngine();
    await engine.infer({
      messages: [{ role: 'user', content: 'Hi' }],
      stream: rawStream,
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(chunks).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'reasoning', text: 'internal' },
      { type: 'reasoning', text: ' reasoning' },
      { type: 'text', text: 'world' },
      { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    ]);
  });

  it('should not emit raw thinking tags in text chunks', async () => {
    registerProvider('mock', {
      generate: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }),
      stream: async function* () {
        yield { type: 'text', text: '<think>reasoning</think>visible' };
      },
    });

    const textChunks: string[] = [];
    const provider = resolveProvider('mock');
    const rawStream = provider.stream({ model: 'model', apiKey: 'key', messages: [] });

    const engine = new InferenceEngine();
    await engine.infer({
      messages: [],
      stream: rawStream,
      onChunk: (chunk) => {
        if (chunk.type === 'text') {
          textChunks.push(chunk.text);
        }
      },
    });

    expect(textChunks.join('')).not.toContain('<think>');
    expect(textChunks.join('')).not.toContain('</think>');
  });
});
