export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: Date;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export interface ToolCallRecord extends ToolCall {
  result?: ToolResult;
  error?: string;
  durationMs: number;
  timestamp: Date;
}

export interface UserInput {
  content: string;
  timestamp?: Date;
}

export interface AgentOutput {
  content: string;
  toolCalls: ToolCallRecord[];
  completed: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type AgentStatus = 'idle' | 'running' | 'error';

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}
