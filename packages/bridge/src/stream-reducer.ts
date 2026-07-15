import type { AssistantMessageEvent } from 'rem-agent-core';
import type { UiContentBlock } from './types.js';

export type { AssistantMessageEvent } from 'rem-agent-core';
export type { AgentStreamEvent } from 'rem-agent-core';
export type { UiContentBlock, ToolResultBlock } from './types.js';

export function reduceStreamEvent(
  parts: UiContentBlock[],
  event: AssistantMessageEvent,
): UiContentBlock[] {
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
    case 'toolcall_end':
      next[event.contentIndex] = event.toolCall;
      break;
    case 'text_end':
    case 'thinking_end':
    case 'toolcall_start':
    case 'toolcall_delta':
    case 'start':
    case 'done':
    case 'error':
      break;
  }
  return next;
}
