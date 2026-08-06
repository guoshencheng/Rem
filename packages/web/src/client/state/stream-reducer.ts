import type { AssistantMessageEvent, ToolCall } from 'rem-agent-core';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | ToolCall;

export function reduceStreamEvent(parts: ContentBlock[], event: AssistantMessageEvent): ContentBlock[] {
  const next = [...parts];
  switch (event.type) {
    case 'text_start':
      next[event.contentIndex] = { type: 'text', text: '' };
      break;
    case 'text_delta': {
      const existing = next[event.contentIndex];
      next[event.contentIndex] = existing?.type === 'text'
        ? { type: 'text', text: existing.text + event.delta }
        : { type: 'text', text: event.delta };
      break;
    }
    case 'thinking_start':
      next[event.contentIndex] = { type: 'thinking', thinking: '' };
      break;
    case 'thinking_delta': {
      const existing = next[event.contentIndex];
      next[event.contentIndex] = existing?.type === 'thinking'
        ? { type: 'thinking', thinking: existing.thinking + event.delta }
        : { type: 'thinking', thinking: event.delta };
      break;
    }
    case 'toolcall_start':
    case 'toolcall_delta': {
      const partial = event.partial.content[event.contentIndex];
      if (partial?.type === 'toolCall') next[event.contentIndex] = partial;
      break;
    }
    case 'toolcall_end':
      next[event.contentIndex] = event.toolCall;
      break;
    default:
      break;
  }
  return next;
}
