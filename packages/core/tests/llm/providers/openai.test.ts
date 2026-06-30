import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.filter(c => c.type === 'text').map(c => c.text).join('');
    expect(text).toBe('Hello world');
  });

  it('should pass system message as first message in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK', tool_calls: [] } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      system: 'You are a tester',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'You are a tester' },
          { role: 'user', content: 'Hi' },
        ],
      }),
      expect.anything(),
    );
  });

  it('should convert tool result messages in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Done', tool_calls: [] } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    });

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    await openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tc1', output: '42' }] } as any,
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'tool', tool_call_id: 'tc1', content: '42' },
        ],
      }),
      expect.anything(),
    );
  });

  it('should propagate errors from generate()', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('rate limited'));

    vi.mocked(OpenAI).mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    }) as any);

    await expect(openaiProvider.generate({
      model: 'gpt-4o',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })).rejects.toThrow('rate limited');
  });

  it('should stream tool-call chunks', async () => {
    async function* mockStream() {
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'tc1',
              function: { name: 'echo', arguments: '' },
            }],
          },
        }],
      };
      yield {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '{"msg":"hi"}' },
            }],
          },
        }],
      };
      yield {
        choices: [{
          finish_reason: 'tool_calls',
        }],
      };
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
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })) {
      chunks.push(chunk);
    }

    const toolCalls = chunks.filter(c => c.type === 'tool-call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe('tc1');
    expect(toolCalls[0].toolName).toBe('echo');
    expect(toolCalls[0].input).toEqual({ msg: 'hi' });
  });

  describe('resolveConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should resolve config from env vars', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.OPENAI_MODEL = 'gpt-4.1';
      process.env.OPENAI_BASE_URL = 'https://custom.openai.com';

      const config = openaiProvider.resolveConfig?.();

      expect(config).toEqual({
        apiKey: 'sk-test',
        model: 'gpt-4.1',
        baseURL: 'https://custom.openai.com',
      });
    });

    it('should use default model when OPENAI_MODEL is missing', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      delete process.env.OPENAI_MODEL;

      const config = openaiProvider.resolveConfig?.();

      expect(config).toEqual({
        apiKey: 'sk-test',
        model: 'gpt-4o',
      });
    });

    it('should throw when OPENAI_API_KEY is missing', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => openaiProvider.resolveConfig?.()).toThrow('OPENAI_API_KEY environment variable is required');
    });
  });
});
