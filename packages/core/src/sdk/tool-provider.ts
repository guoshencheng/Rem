import type { Static, TObject } from '@sinclair/typebox';
import type { ToolSet } from '../llm/types.js';
import type { ApprovalChunkEmitter } from './approval-orchestrator.js';

export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId?: string;
}

export interface ToolDefinition<T extends TObject = TObject> {
  name: string;
  description: string;
  parameters: T;
  category?: 'filesystem' | 'shell' | 'search' | 'mcp';
  dangerous?: boolean;
  readOnly?: boolean;
}

export interface ToolExecutorResult {
  output: string;
  details?: unknown;
}

export type ToolExecutor<T extends TObject = TObject> = (
  input: Static<T>,
  ctx: ToolContext,
) => Promise<ToolExecutorResult>;

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
  details?: unknown;
}

export interface ToolProvider {
  register<T extends TObject>(def: ToolDefinition<T>, executor: ToolExecutor<T>): void;
  getToolSet(): ToolSet;
  execute(calls: ToolCall[], ctx: ToolContext, emit?: ApprovalChunkEmitter): Promise<ToolResult[]>;
}
