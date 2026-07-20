import type { TextContent, ThinkingContent, ToolCall } from 'rem-agent-core';
import type { AgentStreamEvent, BusEvent, SessionActivity, Usage } from 'rem-agent-core';

export type { BusEvent, SessionActivity, Usage };

export type UiContentBlock = TextContent | ThinkingContent | ToolCall;

export interface ToolResultBlock {
  type: 'toolResult';
  toolCallId: string;
  toolName?: string;
  output: string;
  error?: string;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UiContentBlock[];
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
  /** 当前正在流式写入的 part 类型；用于 UI 状态指示 */
  activePartType?: 'text' | 'thinking' | 'toolCall';
  tokenUsage?: Usage;
  /** 工具结果按 toolCallId 索引；与 parts 分开，避免 contentIndex 错位 */
  toolResults?: Record<string, ToolResultBlock>;
}

export interface RunRequest {
  sessionId: string;
  content: string;
}

export interface InterruptRequest {
  sessionId: string;
}

export interface ResetRequest {
  sessionId: string;
}

export interface SessionUpdate {
  title?: string;
  pinned?: boolean;
}

export interface Workspace {
  /** workspace 唯一标识符，即目录绝对路径 */
  path: string;
  /** 添加时间戳 */
  createdAt: number;
}

export interface AddWorkspaceRequest {
  path: string;
}

export interface RemoveWorkspaceRequest {
  path: string;
}

export interface SessionSummary {
  sessionId: string;
  workspace: string;
  title?: string;
  pinned?: boolean;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
  tokenUsage?: Usage;
  parentSessionId?: string;
  /** 子 agent 会话对应父消息中 delegate_task 工具调用的 id（用于内嵌渲染定位） */
  parentToolCallId?: string;
}

export type ServerStreamEvent = import('rem-agent-core').AgentStreamEvent;
