export type ContentPart =
  | { type: 'text';        text: string }
  | { type: 'reasoning';   text: string }
  | { type: 'tool-call';   toolCallId: string; toolName: string; arguments: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName?: string; output: string; error?: string };

export type MessageContent = ContentPart[];

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
}

export interface LanguageModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
}

export interface UserInput {
  content: string;
  timestamp?: Date;
}

export interface AgentOutput {
  content: string;
  completed: boolean;
}

export type AgentStreamChunk =
  | { type: 'step-start'; step: number }
  | { type: 'step-finish'; step: number }
  | { type: 'text-start'; step: number; partId: string }
  | { type: 'text-delta'; step: number; partId: string; text: string }
  | { type: 'text-finish'; step: number; partId: string }
  | { type: 'reasoning-start'; step: number; partId: string }
  | { type: 'reasoning-delta'; step: number; partId: string; text: string }
  | { type: 'reasoning-finish'; step: number; partId: string }
  | { type: 'tool-call-start'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-call'; step: number; partId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-call-finish'; step: number; partId: string; toolCallId: string; toolName: string }
  | { type: 'tool-result-start'; step: number; partId: string; toolCallId: string; toolName?: string }
  | { type: 'tool-result'; step: number; partId: string; toolCallId: string; output: string; error?: string }
  | { type: 'tool-result-finish'; step: number; partId: string; toolCallId: string }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error }
  | { type: 'session-title'; title: string };

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
  fullStream: AsyncIterable<AgentStreamChunk>;
  text: Promise<string>;
  usage: Promise<LanguageModelUsage>;
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
  newMessages: ModelMessage[];
  usage: LanguageModelUsage;
}
