import type { Usage } from '@earendil-works/pi-ai';
import type { SessionActivity } from '../../agent/bus-events.js';

export interface SessionInfo {
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
