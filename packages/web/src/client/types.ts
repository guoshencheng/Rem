import type { Message } from 'rem-agent-core';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';
export type SessionActivity = 'idle' | 'running';

export interface WorkbenchSession {
  sessionId: string;
  tenantId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  activity?: SessionActivity;
}

export interface RuntimeChatMessage {
  messageId: string;
  message: Message;
}
