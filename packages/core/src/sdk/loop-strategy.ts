import type { Message, TextContent, ThinkingContent, ToolCall, AssistantMessage, AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentLiveState } from '../state.js';
import type { RemMessage, AgentStreamEvent } from '../types.js';
import type { ToolCall as ToolCallRequest, ToolResult } from './tool-provider.js';

export interface LoopContext {
  liveState: AgentLiveState;
  system: string;
  /** 当前上下文消息（会话 conversation 的引用） */
  messages: Message[];

  stream: () => AssistantMessageEventStream;
  generate: () => Promise<AssistantMessage>;
  execute: (toolCalls: ToolCallRequest[]) => Promise<ToolResult[]>;
  emit: (event: AgentStreamEvent) => void | Promise<void>;

  /** 创建并持久化一条新消息，返回消息包装 */
  addMessage: (role: 'assistant' | 'tool') => RemMessage;
  /** 向消息追加 content block 并持久化 */
  appendContent: (msg: Message, block: TextContent | ThinkingContent | ToolCall) => void;
  resolveMessageId?: (message: Message) => string | undefined;

  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}

export interface LoopResult {
  content: string;
  usage: Usage;
  message?: AssistantMessage;
}

export interface LoopStrategy {
  run(ctx: LoopContext): Promise<LoopResult>;
}
