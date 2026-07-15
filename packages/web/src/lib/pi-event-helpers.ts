import type { AssistantMessageEvent } from 'rem-agent-core';

export function isTextDelta(event: AssistantMessageEvent): boolean {
  return event.type === 'text_delta';
}

export function isThinkingDelta(event: AssistantMessageEvent): boolean {
  return event.type === 'thinking_delta';
}

export function isToolCallEnd(event: AssistantMessageEvent): boolean {
  return event.type === 'toolcall_end';
}

export function isTextStart(event: AssistantMessageEvent): boolean {
  return event.type === 'text_start';
}

export function isThinkingStart(event: AssistantMessageEvent): boolean {
  return event.type === 'thinking_start';
}

export function isToolCallStart(event: AssistantMessageEvent): boolean {
  return event.type === 'toolcall_start';
}

export function isDone(event: AssistantMessageEvent): boolean {
  return event.type === 'done';
}

export function isError(event: AssistantMessageEvent): boolean {
  return event.type === 'error';
}
