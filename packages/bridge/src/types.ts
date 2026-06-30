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

export interface SessionSummary {
  sessionId: string;
  title?: string;
  updatedAt: number;
  messageCount: number;
}

export type ServerStreamEvent = AgentStreamChunk;
