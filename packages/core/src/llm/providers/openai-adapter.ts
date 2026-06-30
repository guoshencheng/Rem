import OpenAI from 'openai';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';
import type { MessageContent } from '../../types.js';
import { debugLog } from '../../shared/debug-log.js';

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function convertAssistantContent(content: MessageContent): OpenAI.Chat.ChatCompletionAssistantMessageParam {
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

  return {
    role: 'assistant',
    content: text,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

export function convertToOpenAIMessages(
  messages: GenerateOptions['messages'],
  system?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (system) {
    result.push({ role: 'system', content: system });
  }
  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ') });
    } else if (msg.role === 'assistant') {
      result.push(convertAssistantContent(msg.content));
    } else if (msg.role === 'tool') {
      const parts = msg.content;
      const part = parts.find((p) => p.type === 'tool-result') as { toolCallId: string; output: string } | undefined;
      result.push({
        role: 'tool',
        tool_call_id: part?.toolCallId ?? '',
        content: part?.output ?? '',
      });
    }
  }
  return result;
}

export function convertToOpenAITools(tools: GenerateOptions['tools']): OpenAI.Chat.ChatCompletionTool[] {
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

export function parseOpenAIResponse(response: OpenAI.Chat.Completions.ChatCompletion): GenerateResult {
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

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function* parseOpenAIChunk(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  pending: Map<number, PendingToolCall>,
): Generator<StreamChunk> {
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const finishReason = choice?.finish_reason;
  debugLog('openai', `id=${chunk.id} model=${chunk.model} finish=${finishReason ?? '-'} delta=${JSON.stringify(delta)?.slice(0, 300)}`);

  if (delta?.content) {
    yield { type: 'text', text: delta.content };
  }

  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      let current = pending.get(index);
      if (!current) {
        current = { id: tc.id ?? '', name: '', arguments: '' };
        pending.set(index, current);
      }
      if (tc.id) current.id = tc.id;
      if (tc.function?.name) current.name += tc.function.name;
      if (tc.function?.arguments) current.arguments += tc.function.arguments;
    }
  }

  if (finishReason === 'tool_calls' || finishReason === 'stop') {
    for (const pendingCall of pending.values()) {
      if (!pendingCall.name) continue;
      yield {
        type: 'tool-call',
        toolCallId: pendingCall.id,
        toolName: pendingCall.name,
        input: safeJsonParse(pendingCall.arguments || '{}'),
      };
    }
    pending.clear();
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
