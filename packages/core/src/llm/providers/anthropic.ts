import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';

function convertToAnthropicMessages(messages: GenerateOptions['messages']): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content as string });
    } else if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string') {
        result.push({ role: 'assistant', content });
      } else if (Array.isArray(content)) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const part of content) {
          if (part.type === 'text') {
            blocks.push({ type: 'text', text: part.text });
          } else if (part.type === 'tool-call') {
            blocks.push({
              type: 'tool_use',
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
            });
          }
        }
        result.push({ role: 'assistant', content: blocks });
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as any;
      result.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolMsg.toolCallId,
          content: msg.content as string,
        }],
      });
    }
  }

  return result;
}

function convertToAnthropicTools(tools: GenerateOptions['tools']): Anthropic.Tool[] {
  if (!tools) return [];
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: (tool as any).description ?? '',
    input_schema: (tool as any).parameters ?? { type: 'object' },
  }));
}

function parseAnthropicResponse(response: Anthropic.Message): GenerateResult {
  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map(c => c.text)
    .join('');

  const toolCalls = response.content
    .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
    .map(tc => ({
      toolCallId: tc.id,
      toolName: tc.name,
      input: tc.input,
    }));

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

function* parseAnthropicStreamEvent(event: Anthropic.Messages.RawMessageStreamEvent): Generator<StreamChunk> {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    yield { type: 'text', text: event.delta.text };
  } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    yield {
      type: 'tool-call',
      toolCallId: event.content_block.id,
      toolName: event.content_block.name,
      input: event.content_block.input,
    };
  } else if (event.type === 'message_delta' && event.usage) {
    yield {
      type: 'usage',
      inputTokens: 0,
      outputTokens: event.usage.output_tokens,
      totalTokens: event.usage.output_tokens,
    };
  }
}

export const anthropicProvider: LLMProvider = {
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: convertToAnthropicMessages(options.messages),
      tools: options.tools ? convertToAnthropicTools(options.tools) : undefined,
      temperature: options.temperature,
      stream: false,
    }, { signal: options.signal });

    return parseAnthropicResponse(response);
  },

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const stream = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: convertToAnthropicMessages(options.messages),
      tools: options.tools ? convertToAnthropicTools(options.tools) : undefined,
      temperature: options.temperature,
      stream: true,
    }, { signal: options.signal });

    for await (const event of stream) {
      yield* parseAnthropicStreamEvent(event);
    }

    yield { type: 'finish', reason: 'stop' };
  },
};
