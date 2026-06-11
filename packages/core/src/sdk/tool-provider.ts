import type { ToolSet } from 'ai';
import type { ModelMessage } from '../types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  error?: string;
}

export interface ToolProvider {
  register(tool: ToolDefinition, executor: (input: unknown) => Promise<string>): void;
  getToolSet(): ToolSet;
  execute(calls: ToolCall[]): Promise<ToolResult[]>;
}
