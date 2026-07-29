import type { Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Session, SessionSummary } from '../session.js';
import type { RemMessage } from '../types.js';

export type { Session, SessionSummary };

export interface SessionProvider {
  create(): Promise<Session>;
  load(sessionId: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionSummary[]>;

  /** 创建消息并追加到会话 */
  addMessage(session: Session, role: 'assistant' | 'tool'): RemMessage;
  /** 向消息追加 content block */
  appendContent(session: Session, message: Message, block: TextContent | ThinkingContent | ToolCall): void;
  /** 追加一条已完成的消息并持久化为 tree entry */
  appendMessage(session: Session, message: Message, messageId: string): Promise<void>;
}
