import OpenAI from 'openai';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, ProviderConfig, StreamChunk } from '../types.js';
import { debugLog } from '../../shared/debug-log.js';
import { convertToOpenAIMessages, convertToOpenAITools, parseOpenAIResponse, parseOpenAIChunk } from './openai-adapter.js';
import type { PendingToolCall } from './openai-adapter.js';

export const openaiProvider: LLMProvider = {
  resolveConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required.');
    }
    return {
      apiKey,
      baseURL: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL ?? 'gpt-4o',
    };
  },

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const response = await client.chat.completions.create({
      model: options.model,
      messages: convertToOpenAIMessages(options.messages, options.system),
      tools: options.tools ? convertToOpenAITools(options.tools) : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
    }, { signal: options.signal });

    return parseOpenAIResponse(response);
  },

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    const stream = await client.chat.completions.create({
      model: options.model,
      messages: convertToOpenAIMessages(options.messages, options.system),
      tools: options.tools ? convertToOpenAITools(options.tools) : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }, { signal: options.signal });

    const pending = new Map<number, PendingToolCall>();

    try {
      for await (const chunk of stream) {
        yield* parseOpenAIChunk(chunk, pending);
      }
      debugLog('openai', 'stream ended normally, yielding finish');
    } catch (err) {
      debugLog('openai', `stream error: ${(err as Error).message}`);
      throw err;
    } finally {
      debugLog('openai', 'stream finally block');
    }

    yield { type: 'finish', reason: 'stop' };
  },
};
