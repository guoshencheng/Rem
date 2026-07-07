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
  /** 创建并持久化一条新消息，返回消息引用供 Loop 后续修改 content */
  addMessage: (role: 'assistant' | 'tool') => ModelMessage;

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
