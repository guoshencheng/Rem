import type { AgentStreamChunk, ContentPart } from 'rem-agent-core';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ContentPart[];
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
}

export interface RunRequest {
  sessionId: string;
  content: string;
}

export interface InterruptRequest {
  sessionId: string;
}

export interface ResetRequest {
  sessionId: string;
}

export interface SessionUpdate {
  title?: string;
  pinned?: boolean;
}

export type SessionActivity =
  | 'idle'
  | 'thinking'
  | 'calling-function'
  | 'outputting';

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
}

export type ServerStreamEvent = AgentStreamChunk;

export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity };
