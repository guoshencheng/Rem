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

export type AgentStatus = 'idle' | 'running' | 'error';
