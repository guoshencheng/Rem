import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Tool,
  ToolCall,
  TextContent,
  ThinkingContent,
  Usage,
} from '@earendil-works/pi-ai';
import type { ModelMessage, ContentPart } from './types.js';
import type { ToolSchema } from './sdk/tool-provider.js';

export function toPiMessage(message: ModelMessage): Message {
  switch (message.role) {
    case 'user': {
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      return { role: 'user', content: text, timestamp: Date.now() } as UserMessage;
    }
    case 'assistant': {
      const content: AssistantMessage['content'] = [];
      for (const part of message.content) {
        if (part.type === 'text') content.push({ type: 'text', text: part.text });
        else if (part.type === 'reasoning') content.push({ type: 'thinking', thinking: part.text });
        else if (part.type === 'tool-call') {
          content.push({
            type: 'toolCall',
            id: part.toolCallId,
            name: part.toolName,
            arguments: part.arguments as Record<string, any>,
          });
        }
      }
      return { role: 'assistant', content, timestamp: Date.now() } as AssistantMessage;
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
      } as ToolResultMessage;
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
          content.push({ type: 'tool-call', toolCallId: block.id, toolName: block.name, arguments: block.arguments as unknown });
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
  return { name, description: schema.description, parameters: schema.parameters } as Tool;
}

export function toPiToolResultMessage(result: { toolCallId: string; toolName: string; output: string; error?: string }): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    content: [{ type: 'text', text: result.output }],
    isError: !!result.error,
    timestamp: Date.now(),
  } as ToolResultMessage;
}

export function fromPiAssistantMessage(message: AssistantMessage): {
  text: string;
  reasoning?: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  usage: Usage;
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
    .map((b) => ({ toolCallId: b.id, toolName: b.name, input: b.arguments as unknown }));
  return {
    text,
    reasoning,
    toolCalls,
    usage: message.usage,
    finishReason: message.stopReason ?? 'stop',
  };
}

export interface LegacyModelMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentPart[];
}

export function migrateConversationToPiAi(
  conversation: LegacyModelMessage[],
): { messages: Message[]; messageIds: Map<string, string> } {
  const messageIds = new Map<string, string>();
  const messages: Message[] = [];
  for (const legacy of conversation) {
    if (legacy.role === 'system') continue;
    const message = toPiMessage(legacy as ModelMessage);
    messages.push(message);
    if (legacy.id) {
      messageIds.set(legacy.id, legacy.id);
    }
  }
  return { messages, messageIds };
}

export function resolveMessageIdFromMeta(message: Message, meta?: Map<Message, string>): string | undefined {
  return meta?.get(message);
}
