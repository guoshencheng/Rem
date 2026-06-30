import { describe, it, expect, vi } from 'vitest';
import { anthropicProvider } from '../../../src/llm/providers/anthropic.js';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('@anthropic-ai/sdk');

describe('anthropicProvider', () => {
  it('should generate text', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const result = await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(result.text).toBe('Hello!');
    expect(result.usage.totalTokens).toBe(15);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-7', stream: false }),
      expect.anything(),
    );
  });

  it('should pass system as top-level parameter in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'OK' }],
      usage: { input_tokens: 3, output_tokens: 1 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      system: 'You are a tester',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a tester',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      expect.anything(),
    );
  });

  it('should parse tool_use blocks', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{
        type: 'tool_use',
        id: 'tc1',
        name: 'echo',
        input: { msg: 'hi' },
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const result = await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe('echo');
  });

  it('should convert tool result messages in generate()', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: 5, output_tokens: 1 },
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    await anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tc1', output: '42' }] } as any,
      ],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tc1',
            content: '42',
          }],
        }],
      }),
      expect.anything(),
    );
  });

  it('should stream text chunks', async () => {
    async function* mockStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
      yield { type: 'message_delta', usage: { output_tokens: 2 } };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of anthropicProvider.stream({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })) {
      chunks.push(chunk);
    }

    const text = chunks.filter(c => c.type === 'text').map(c => c.text).join('');
    expect(text).toBe('Hello world');
  });

  it('should propagate errors from generate()', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('overloaded'));

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    await expect(anthropicProvider.generate({
      model: 'claude-sonnet-4-7',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    })).rejects.toThrow('overloaded');
  });

  it('should stream tool_use chunks', async () => {
    async function* mockStream() {
      yield {
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'tc1',
          name: 'echo',
          input: { msg: 'hi' },
        },
      };
      yield {
        type: 'message_delta',
        usage: { output_tokens: 5 },
      };
    }

    const mockCreate = vi.fn().mockResolvedValue(mockStream());
    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as any);

    const chunks: any[] = [];
    for await (const chunk of anthropicProvider.stream({
      model: 'claude-sonnet-4-7',
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
});
