import type { ContentPart, LanguageModelUsage } from 'rem-agent-core';
import type { BusEvent, SessionActivity } from 'rem-agent-core';

export type { BusEvent, SessionActivity, LanguageModelUsage };

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ContentPart[];
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
  /** 当前正在流式写入的 part 类型；reasoning-finish/text-finish 等结束后会被清空 */
  activePartType?: 'text' | 'reasoning' | 'tool-call' | 'tool-result';
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

export interface SessionSummary {
  sessionId: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
  tokenUsage?: LanguageModelUsage;
}

export type ServerStreamEvent = import('rem-agent-core').AgentStreamChunk;
