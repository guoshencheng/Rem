import type { AgentLiveState } from '../state.js';
import type { Session } from '../session.js';
import type { ModelMessage, LanguageModelUsage, ProviderChunk } from '../types.js';
import type { ReasonOutput } from './reason-provider.js';
import type { ToolCall, ToolResult } from './tool-provider.js';

export interface LoopContext {
  session: Session;
  liveState: AgentLiveState;
  /** 预构建的 system prompt（已含 skills） */
  system: string;
  /** 当前上下文消息（Loop 内部会更新） */
  messages: ModelMessage[];

  /** 推理回调（runAgent 绑定 ReasonProvider + model config + streaming） */
  reason: () => Promise<ReasonOutput>;
  /** 执行回调（runAgent 绑定 ExecuteProvider + 审批 + streaming） */
  execute: (toolCalls: ToolCall[]) => Promise<ToolResult[]>;
  /** 流式输出回调（runAgent 绑定 AgentStreamController） */
  emit: (chunk: ProviderChunk) => void | Promise<void>;

  signal?: AbortSignal;
  maxSteps?: number;
  workspaceRoot: string;
  readOnly?: boolean;
  agentName?: string;
  sessionId?: string;
}

export interface LoopResult {
  content: string;
  newMessages: ModelMessage[];
  usage: LanguageModelUsage;
}

export interface LoopStrategy {
  run(ctx: LoopContext): Promise<LoopResult>;
}
