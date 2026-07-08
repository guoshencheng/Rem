import Anthropic from '@anthropic-ai/sdk';
import type { GenerateOptions, GenerateResult, StreamChunk } from '../types.js';
import type { MessageContent } from '../../types.js';
import { debugLog } from '../../shared/debug-log.js';

export function convertToAnthropicMessages(messages: GenerateOptions['messages']): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ') });
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
              input: part.arguments,
            });
          }
        }
        result.push({ role: 'assistant', content: blocks });
      }
    } else if (msg.role === 'tool') {
      const parts = msg.content;
      const part = parts.find((p) => p.type === 'tool-result') as { toolCallId: string; output: string } | undefined;
      result.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: part?.toolCallId ?? '',
          content: part?.output ?? '',
        }],
      });
    }
  }

  return result;
}

export function convertToAnthropicTools(tools: GenerateOptions['tools']): Anthropic.Tool[] {
  if (!tools) return [];
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: (tool as any).description ?? '',
    input_schema: (tool as any).parameters ?? { type: 'object' },
  }));
}

function buildAnthropicInputTokenDetails(usage: Anthropic.Message['usage']) {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  if (cacheRead === 0 && cacheWrite === 0) return undefined;
  return {
    noCacheTokens: Math.max(0, usage.input_tokens - cacheRead - cacheWrite),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

function buildAnthropicOutputTokenDetails(usage: Anthropic.Message['usage']) {
  if (!usage.output_tokens_details) return undefined;
  const reasoning = usage.output_tokens_details.thinking_tokens ?? 0;
  return {
    textTokens: Math.max(0, usage.output_tokens - reasoning),
    reasoningTokens: reasoning,
  };
}

export function parseAnthropicResponse(response: Anthropic.Message): GenerateResult {
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
      inputTokenDetails: buildAnthropicInputTokenDetails(response.usage),
      outputTokenDetails: buildAnthropicOutputTokenDetails(response.usage),
    },
  };
}

export function* parseAnthropicStreamEvent(event: Anthropic.Messages.RawMessageStreamEvent): Generator<StreamChunk> {
  debugLog('anthropic', `type=${event.type} subtype=${(event as any).delta?.type ?? (event as any).content_block?.type ?? '-'}`);
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    yield { type: 'text', text: event.delta.text };
  } else if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
    yield { type: 'reasoning', text: event.delta.thinking };
  } else if (event.type === 'content_block_delta' && event.delta.type === 'signature_delta') {
    // signature deltas are part of the thinking block — skip, not user-visible
  } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    yield {
      type: 'tool-call',
      toolCallId: event.content_block.id,
      toolName: event.content_block.name,
      input: event.content_block.input,
    };
  } else if (event.type === 'content_block_stop') {
    // content block ended — no additional action needed
  } else if (event.type === 'message_start') {
    const message = event.message as any;
    if (message?.usage) {
      yield {
        type: 'usage',
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
        totalTokens: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
        inputTokenDetails: buildAnthropicInputTokenDetails(message.usage),
        outputTokenDetails: buildAnthropicOutputTokenDetails(message.usage),
      };
    }
  } else if (event.type === 'message_delta' && event.usage) {
    yield {
      type: 'usage',
      inputTokens: 0,
      outputTokens: event.usage.output_tokens,
      totalTokens: event.usage.output_tokens,
      outputTokenDetails: buildAnthropicOutputTokenDetails(event.usage as Anthropic.Message['usage']),
    };
  }
}
