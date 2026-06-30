import type { AgentStreamChunk, UIMessage, SessionSummary as CoreSessionSummary } from 'rem-agent-bridge';

export interface SessionSummary extends CoreSessionSummary {
  pinned?: boolean;
}

export function isSSETextDelta(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'text-delta' } {
  return c.type === 'text-delta';
}

export function isSSEReasoningDelta(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'reasoning-delta' } {
  return c.type === 'reasoning-delta';
}

export function isSSEReasoningFinish(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'reasoning-finish' } {
  return c.type === 'reasoning-finish';
}

export function isSSEToolCallStart(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'tool-call-start' } {
  return c.type === 'tool-call-start';
}

export function isSSEToolResult(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'tool-result' } {
  return c.type === 'tool-result';
}

export function isSSEFinish(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'finish' } {
  return c.type === 'finish';
}

export function isSSEError(c: AgentStreamChunk): c is AgentStreamChunk & { type: 'error' } {
  return c.type === 'error';
}

export type { AgentStreamChunk, UIMessage };
