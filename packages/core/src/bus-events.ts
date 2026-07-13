import type { AgentStreamChunk, ContentPart, LanguageModelUsage } from './types.js';
import type { TodoItem } from './todo/types.js';

export type SessionActivity =
  | 'idle'
  | 'pending'
  | 'thinking'
  | 'calling-function'
  | 'outputting'
  | 'compressing';

export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity }
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: ContentPart[] }
  | { workspace: string; sessionId: string; type: 'usage-change'; usage: LanguageModelUsage }
  | {
      workspace: string;
      sessionId: string;
      type: 'child-agent-update';
      childSessionId: string;
      summary: string;
      status: 'running' | 'completed' | 'failed';
      tokenUsage?: LanguageModelUsage;
    }
  | {
      workspace: string;
      sessionId: string;
      type: 'todo-updated';
      todos: TodoItem[];
    };
