import type { ModelMessage, LanguageModelUsage } from 'ai';

export { type ModelMessage, type LanguageModelUsage } from 'ai';

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
  | { type: 'text-delta'; step: number; text: string }
  | { type: 'reasoning-delta'; step: number; text: string }
  | { type: 'tool-call'; step: number; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; step: number; toolCallId: string; output: string; error?: string }
  | { type: 'step-finish'; step: number }
  | { type: 'finish'; output: AgentOutput }
  | { type: 'error'; error: Error };

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
