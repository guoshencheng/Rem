import { describe, it, expect } from 'vitest';
import { StreamCollector, collectStream } from '../../src/llm/stream-collector.js';
import type { StreamChunk } from '../../src/llm/types.js';

describe('StreamCollector', () => {
  it('should aggregate text chunks', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'text', text: 'Hello' });
    collector.feed({ type: 'text', text: ' world' });
    expect(collector.result().text).toBe('Hello world');
  });

  it('should aggregate tool calls', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'tool-call', toolCallId: 'tc1', toolName: 'echo', input: { msg: 'hi' } });
    expect(collector.result().toolCalls).toHaveLength(1);
    expect(collector.result().toolCalls[0].toolName).toBe('echo');
  });

  it('should aggregate usage', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'usage', inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(collector.result().usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('should ignore finish chunks', () => {
    const collector = new StreamCollector();
    collector.feed({ type: 'finish', reason: 'stop' });
    expect(collector.result().text).toBe('');
  });
});

describe('collectStream', () => {
  it('should collect async stream', async () => {
    async function* stream(): AsyncIterable<StreamChunk> {
      yield { type: 'text', text: 'Hi' };
      yield { type: 'usage', inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    }

    const result = await collectStream(stream());
    expect(result.text).toBe('Hi');
    expect(result.usage.totalTokens).toBe(2);
  });
});
