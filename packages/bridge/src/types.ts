import type { AgentStreamChunk } from 'rem-agent-core';

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
