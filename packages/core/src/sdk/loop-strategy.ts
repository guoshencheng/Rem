import type { AgentLiveState } from '../state.js';
import type { ModelMessage, LanguageModelUsage, ProviderChunk } from '../types.js';
import type { ToolCall, ToolResult } from './tool-provider.js';

export interface LoopCallReason {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  reasoning?: string;
  usage: LanguageModelUsage;
  finishReason: string;
}

export interface LoopContext {
  liveState: AgentLiveState;
  system: string;
  /** 当前上下文消息（会话 conversation 的引用） */
  messages: ModelMessage[];

  reason: () => Promise<LoopCallReason>;
  execute: (toolCalls: ToolCall[]) => Promise<ToolResult[]>;
  emit: (chunk: ProviderChunk) => void | Promise<void>;
  /** 追加消息到会话并持久化 */
  appendMessage: (msg: ModelMessage) => void | Promise<void>;

  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}

export interface LoopResult {
  content: string;
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  run(ctx: LoopContext): Promise<LoopResult>;
}
