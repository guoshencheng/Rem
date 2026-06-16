import OpenAI from 'openai';
import type { LLMProvider } from '../api-registry.js';
import type { GenerateOptions, GenerateResult, ProviderConfig, StreamChunk } from '../types.js';
import { debugLog } from '../../shared/debug-log.js';

function convertAssistantContent(content: unknown): OpenAI.Chat.ChatCompletionAssistantMessageParam {
  if (typeof content === 'string') {
    return { role: 'assistant', content };
  }

  if (!Array.isArray(content)) {
    return { role: 'assistant', content: String(content) };
  }

  const text = content
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text)
    .join('');

  const toolCalls = content
    .filter((part: any) => part.type === 'tool-call')
    .map((part: any) => ({
      id: part.toolCallId,
      type: 'function' as const,
      function: {
        name: part.toolName,
        arguments: JSON.stringify(part.input),
      },
    }));

  // reasoning parts: OpenAI input does not support them, drop.
  return {
    role: 'assistant',
    content: text,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function convertToOpenAIMessages(
  messages: GenerateOptions['messages'],
  system?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) {
    result.push({ role: 'system', content: system });
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content as unknown as string });
    } else if (msg.role === 'assistant') {
      result.push(convertAssistantContent(msg.content));
    } else if (msg.role === 'tool') {
      const toolMsg = msg as any;
      result.push({
        role: 'tool',
        tool_call_id: toolMsg.toolCallId,
        content: msg.content as unknown as string,
      });
    }
  }
  return result;
}

function convertToOpenAITools(tools: GenerateOptions['tools']): OpenAI.Chat.ChatCompletionTool[] {
  if (!tools) return [];
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function' as const,
    function: {
      name,
      description: (tool as any).description ?? '',
      parameters: (tool as any).parameters ?? { type: 'object' },
    },
  }));
}

function parseOpenAIResponse(response: OpenAI.Chat.ChatCompletion): GenerateResult {
  const message = response.choices[0]?.message ?? { content: '', tool_calls: [] };
  const text = message.content ?? '';
  const toolCalls = (message.tool_calls ?? []).map(tc => ({
    toolCallId: tc.id,
    toolName: (tc as any).function.name,
    input: safeJsonParse((tc as any).function.arguments),
  }));

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}

function* parseOpenAIChunk(chunk: OpenAI.Chat.ChatCompletionChunk): Generator<StreamChunk> {
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const finishReason = choice?.finish_reason;
  debugLog('openai', `id=${chunk.id} model=${chunk.model} finish=${finishReason ?? '-'} delta=${JSON.stringify(delta)?.slice(0, 300)}`);
  if (!delta) return;

  if (delta.content) {
    yield { type: 'text', text: delta.content };
  }

  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        yield {
          type: 'tool-call',
          toolCallId: tc.id ?? '',
          toolName: tc.function.name,
          input: safeJsonParse(tc.function.arguments ?? '{}'),
        };
      }
    }
  }

  if (chunk.usage) {
    yield {
      type: 'usage',
      inputTokens: chunk.usage.prompt_tokens,
      outputTokens: chunk.usage.completion_tokens,
      totalTokens: chunk.usage.total_tokens,
    };
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

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

    try {
      for await (const chunk of stream) {
        yield* parseOpenAIChunk(chunk);
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
