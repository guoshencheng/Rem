import type { AgentStreamChunk, ToolCallRecord } from 'rem-agent-core';

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
  pinned?: boolean;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls: ToolCallRecord[];
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
}

export interface RunResponse {
  sessionId: string;
  streamUrl: string;
}

export interface SSEEvent {
  event?: string;
  data: string;
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

export type { AgentStreamChunk, ToolCallRecord };
