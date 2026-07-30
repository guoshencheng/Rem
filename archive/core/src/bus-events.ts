import type { TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentStreamEvent } from './types.js';
import type { TodoItem } from './todo/types.js';

export type SessionActivity =
  | 'idle'
  | 'pending'
  | 'thinking'
  | 'calling-function'
  | 'outputting'
  | 'compressing';

export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamEvent; agentId?: string }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity }
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: Array<TextContent | ThinkingContent | ToolCall> }
  | { workspace: string; sessionId: string; type: 'usage-change'; usage: Usage }
  | {
      workspace: string;
      sessionId: string;
      type: 'child-agent-update';
      childSessionId: string;
      toolCallId?: string;
      summary: string;
      status: 'running' | 'completed' | 'failed';
      tokenUsage?: Usage;
    }
  | {
      workspace: string;
      sessionId: string;
      type: 'todo-updated';
      todos: TodoItem[];
    };
