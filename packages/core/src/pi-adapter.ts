import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Tool,
  ToolCall,
  TextContent,
  ThinkingContent,
  AssistantMessageEvent,
  Usage,
} from '@earendil-works/pi-ai';
import type { ModelMessage, ContentPart, ProviderChunk, LanguageModelUsage } from './types.js';
import type { ToolSchema } from './llm/types.js';

export function toPiMessage(message: ModelMessage): Message {
  switch (message.role) {
    case 'user': {
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      return { role: 'user', content: text, timestamp: Date.now() } satisfies UserMessage;
    }
    case 'assistant': {
      const content: AssistantMessage['content'] = [];
      for (const part of message.content) {
        if (part.type === 'text') content.push({ type: 'text', text: part.text });
        else if (part.type === 'reasoning') content.push({ type: 'thinking', thinking: part.text });
        else if (part.type === 'tool-call') {
          content.push({ type: 'toolCall', id: part.toolCallId, name: part.toolName, arguments: part.arguments });
        }
      }
      return { role: 'assistant', content, timestamp: Date.now() } satisfies AssistantMessage;
    }
    case 'tool': {
      // tool-result parts 应该已经在 execute-tools 处理为 ToolResultMessage，这里做兜底转换
      const results = message.content.filter((p): p is { type: 'tool-result'; toolCallId: string; toolName?: string; output: string; error?: string } => p.type === 'tool-result');
      if (results.length !== 1) {
        throw new Error('Expected exactly one tool-result part per tool role message');
      }
      return {
        role: 'toolResult',
        toolCallId: results[0].toolCallId,
        toolName: results[0].toolName ?? '',
        content: [{ type: 'text', text: results[0].output }],
        isError: !!results[0].error,
        timestamp: Date.now(),
      } satisfies ToolResultMessage;
    }
    case 'system':
      // system 消息不应出现在 conversation 中，应进入 Context.systemPrompt
      throw new Error('System message should not be converted to pi-ai message');
    default:
      throw new Error(`Unknown role: ${message.role}`);
  }
}

export function fromPiMessage(message: Message, messageId: string): ModelMessage {
  switch (message.role) {
    case 'user':
      return {
        id: messageId,
        role: 'user',
        content: [{ type: 'text', text: typeof message.content === 'string' ? message.content : message.content.map((c) => (c.type === 'text' ? c.text : '')).join('') }],
      };
    case 'assistant': {
      const content: ContentPart[] = [];
      for (const block of message.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'thinking') content.push({ type: 'reasoning', text: block.thinking });
        else if (block.type === 'toolCall') {
          content.push({ type: 'tool-call', toolCallId: block.id, toolName: block.name, arguments: block.arguments });
        }
      }
      return { id: messageId, role: 'assistant', content };
    }
    case 'toolResult':
      return {
        id: messageId,
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: message.toolCallId, toolName: message.toolName, output: message.content.map((c) => (c.type === 'text' ? c.text : '')).join(''), error: message.isError ? 'error' : undefined }],
      };
    default:
      throw new Error(`Unknown pi-ai role: ${(message as any).role}`);
  }
}

export function toPiTool(name: string, schema: ToolSchema): Tool {
  return { name, description: schema.description, parameters: schema.parameters };
}

export function toPiToolResultMessage(result: { toolCallId: string; toolName: string; output: string; error?: string }): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    content: [{ type: 'text', text: result.output }],
    isError: !!result.error,
    timestamp: Date.now(),
  };
}

export function* toLegacyProviderChunks(event: AssistantMessageEvent): Generator<ProviderChunk> {
  switch (event.type) {
    case 'text_delta':
      yield { type: 'text-delta', step: 0, text: event.delta };
      break;
    case 'thinking_delta':
      yield { type: 'reasoning-delta', step: 0, text: event.delta };
      break;
    case 'toolcall_end': {
      const tc = event.toolCall;
      yield { type: 'tool-call', step: 0, toolCallId: tc.id, toolName: tc.name, input: tc.arguments };
      break;
    }
    case 'done':
    case 'error':
    case 'start':
    case 'text_start':
    case 'text_end':
    case 'thinking_start':
    case 'thinking_end':
    case 'toolcall_start':
    case 'toolcall_delta':
      // Phase 1 忽略这些事件，Phase 2 再消费
      break;
  }
}

export function fromPiAssistantMessage(message: AssistantMessage): {
  text: string;
  reasoning?: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  usage: LanguageModelUsage;
  finishReason: string;
} {
  const text = message.content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const reasoning = message.content
    .filter((b): b is ThinkingContent => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n') || undefined;
  const toolCalls = message.content
    .filter((b): b is ToolCall => b.type === 'toolCall')
    .map((b) => ({ toolCallId: b.id, toolName: b.name, input: b.arguments }));
  return {
    text,
    reasoning,
    toolCalls,
    usage: piUsageToLanguageModelUsage(message.usage),
    finishReason: message.stopReason ?? 'stop',
  };
}

export function piUsageToLanguageModelUsage(usage: Usage): LanguageModelUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    inputTokenDetails: {
      noCacheTokens: usage.input - usage.cacheRead - usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
    },
    outputTokenDetails: {
      textTokens: usage.output - (usage.reasoning ?? 0),
      reasoningTokens: usage.reasoning,
    },
  };
}

export function languageModelUsageToPiUsage(usage: LanguageModelUsage): Usage {
  const details = usage.inputTokenDetails ?? {};
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: details.cacheReadTokens ?? 0,
    cacheWrite: details.cacheWriteTokens ?? 0,
    totalTokens: usage.totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
