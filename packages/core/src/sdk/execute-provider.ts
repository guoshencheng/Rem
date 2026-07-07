import type { ProviderChunk } from '../types.js';
import type { ToolCall, ToolResult } from './tool-provider.js';

export interface ExecuteContext {
  cwd: string;
  workspaceRoot: string;
  signal?: AbortSignal;
  agentName?: string;
  readOnly?: boolean;
  sessionId: string;
}

export interface ExecuteProvider {
  execute(
    toolCalls: ToolCall[],
    ctx: ExecuteContext,
    emit: (chunk: ProviderChunk) => void | Promise<void>,
  ): Promise<ToolResult[]>;
}
