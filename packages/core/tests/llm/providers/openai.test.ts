import { describe, it, expect, vi } from 'vitest';
import { openaiProvider } from '../../../src/llm/providers/openai.js';
import OpenAI from 'openai';

vi.mock('openai');

describe('openaiProvider', () => {
  it('should generate text', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: 'Hello!',
          tool_calls: [],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const result = await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.text).toBe('Hello!');
    expect(result.usage.totalTokens).toBe(15);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', stream: false }),
      expect.anything(),
    );
  });

  it('should parse tool calls', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'tc1',
            function: { name: 'echo', arguments: '{"msg":"hi"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const result = await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: {
        echo: { description: 'echo', parameters: { type: 'object' } },
      } as any,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('echo');
    expect(result.toolCalls[0].input).toEqual({ msg: 'hi' });
  });

  it('should stream text chunks', async () => {
    async function* mockStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' world' } }] };
      yield { usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of openaiProvider.stream({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.filter(c => c.type === 'text').map(c => c.text).join('');
    expect(text).toBe('Hello world');
  });
});
