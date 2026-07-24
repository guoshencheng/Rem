import type { AssistantMessageEvent } from 'rem-agent-core';
import type { UIMessage, BusEvent, SessionActivity } from 'rem-agent-bridge';

export type { UIMessage, BusEvent, SessionActivity, AssistantMessageEvent };

export function isSSETextDelta(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'text_delta' }> {
  return c.type === 'text_delta';
}

export function isSSEThinkingDelta(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'thinking_delta' }> {
  return c.type === 'thinking_delta';
}

export function isSSEThinkingStart(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'thinking_start' }> {
  return c.type === 'thinking_start';
}

export function isSSEThinkingEnd(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'thinking_end' }> {
  return c.type === 'thinking_end';
}

export function isSSEToolCallEnd(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'toolcall_end' }> {
  return c.type === 'toolcall_end';
}

export function isSSETextStart(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'text_start' }> {
  return c.type === 'text_start';
}

export function isSSETextEnd(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'text_end' }> {
  return c.type === 'text_end';
}

export function isSSEToolCallStart(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'toolcall_start' }> {
  return c.type === 'toolcall_start';
}

export function isSSEFinish(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'done' }> {
  return c.type === 'done';
}

export function isSSEError(c: AssistantMessageEvent): c is Extract<AssistantMessageEvent, { type: 'error' }> {
  return c.type === 'error';
}

export function isSSEStepStart(c: AssistantMessageEvent): boolean {
  return false;
}

export function isSSEStepFinish(c: AssistantMessageEvent): boolean {
  return false;
}
