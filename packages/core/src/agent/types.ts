import type { ApprovalRequest, ApprovalDecision } from '../sdk/agent-state-provider.js';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { Message, Usage, TextContent, ImageContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';

export interface StreamingSnapshot {
  messageId: string;
  parts: Array<TextContent | ThinkingContent | ToolCall | undefined>;
}

export interface StreamErrorInfo {
  name: string;
  message: string;
  reason?: 'error' | 'aborted';
  stack?: string;
}

export interface RemMessage {
  messageId: string;
  message: Message;
  tokenUsage?: Usage;
}

export type RemMetaEvent =
  | { type: 'session-title'; title: string }
  | { type: 'approval-request'; sessionId: string; request: ApprovalRequest }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; decision: ApprovalDecision | null }
  | { type: 'compress-start'; sessionId: string; estimatedTokens: number; threshold: number }
  | { type: 'compress-end'; sessionId: string; archiveId: string; removedMessageCount: number }
  | { type: 'compress-error'; sessionId: string; error: string }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: StreamErrorInfo };

export type AgentStreamEvent = AgentEvent | RemMetaEvent;

export type UserInputContent = string | (TextContent | ImageContent)[];

export interface UserInput {
  content: UserInputContent;
  timestamp?: Date;
}

export interface AgentOutput {
  content: string;
  completed: boolean;
}

export interface AgentStreamStepResult {
  step: number;
  text: string;
  reasoning: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output?: string;
    error?: string;
  }>;
}

export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamEvent>;
  text: Promise<string>;
  usage: Promise<Usage>;
  steps: Promise<AgentStreamStepResult[]>;
}

export type AgentStatus = 'idle' | 'running' | 'error';

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: {
    success: boolean;
    output: string;
    error?: string;
    durationMs: number;
  };
  error?: string;
  durationMs: number;
  timestamp: Date;
}

export interface TurnResult {
  content: string;
  newMessages: Message[];
  usage: Usage;
}
