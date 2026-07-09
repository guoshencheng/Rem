import type { Static, TObject } from '@sinclair/typebox';
import type { ToolSet } from '../llm/types.js';
import type { Rule } from '../security/rules/rule.js';

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
  /** Derive rule patterns from a tool call input. */
  derivePatterns?: (input: Static<T>) => string[];
  /** Generate always-options for the approval UI. */
  deriveAlwaysOptions?: (input: Static<T>) => Array<{ label: string; rule: Omit<Rule, 'source'> }>;
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
  /** Look up a tool definition by name. */
  getToolDefinition(name: string): ToolDefinition | undefined;
  /** 纯执行，不含审批。审批由 runAgent 在调用前通过 isDangerous 判断。 */
  execute(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]>;
  /** 查询工具是否危险（runAgent 用于决定是否触发审批） */
  isDangerous(toolName: string): boolean;
}
