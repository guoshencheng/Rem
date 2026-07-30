import type { AssistantMessageEvent, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

export type StreamingContentBlock = TextContent | ThinkingContent | ToolCall;

export function reduceStreamEvent(
  parts: Array<StreamingContentBlock | undefined>,
  event: AssistantMessageEvent,
): Array<StreamingContentBlock | undefined> {
  const next = [...parts];
  switch (event.type) {
    case 'text_start':
      next[event.contentIndex] = { type: 'text', text: '' };
      break;
    case 'text_delta': {
      const existing = next[event.contentIndex];
      if (existing?.type === 'text') {
        next[event.contentIndex] = { type: 'text', text: existing.text + event.delta };
      } else {
        next[event.contentIndex] = { type: 'text', text: event.delta };
      }
      break;
    }
    case 'thinking_start':
      next[event.contentIndex] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta': {
      const existing = next[event.contentIndex];
      if (existing?.type === 'thinking') {
        next[event.contentIndex] = { type: 'thinking', thinking: existing.thinking + event.delta };
      } else {
        next[event.contentIndex] = { type: 'thinking', thinking: event.delta };
      }
      break;
    }
    case 'toolcall_start':
    case 'toolcall_delta': {
      const partial = event.partial.content[event.contentIndex];
      if (partial?.type === 'toolCall') {
        next[event.contentIndex] = {
          type: 'toolCall',
          id: partial.id,
          name: partial.name,
          arguments: partial.arguments,
        };
      }
      break;
    }
    case 'toolcall_end':
      next[event.contentIndex] = event.toolCall;
      break;
    case 'text_end':
    case 'thinking_end':
    case 'start':
    case 'done':
    case 'error':
      break;
  }
  return next;
}

export function compactContentBlocks(
  parts: Array<StreamingContentBlock | undefined>,
): StreamingContentBlock[] {
  return parts.filter((p): p is StreamingContentBlock => p !== undefined);
}
