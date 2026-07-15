import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';
import { convertToAnthropicMessages, convertToAnthropicTools, parseAnthropicResponse, parseAnthropicStreamEvent } from './anthropic-adapter.js';

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
