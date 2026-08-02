import type { TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentStreamEvent } from './types.js';
import type { TodoItem } from '../capabilities/todo/types.js';
import type { MessageDelivery } from '../orchestration/delivery-model.js';
import type { DiscussionRuntimeStatus } from '../orchestration/discussion-runtime.js';

export type SessionActivity =
  | 'idle'
  | 'pending'
  | 'thinking'
  | 'calling-function'
  | 'outputting'
  | 'compressing';

export type AgentSystemEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamEvent; agentId?: string; agentThreadId?: string }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'delivery-change'; delivery: MessageDelivery }
  | { workspace: string; sessionId: string; type: 'discussion-change'; rootUserMessageId: string; status: DiscussionRuntimeStatus }
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
      status: 'running' | 'completed' | 'failed' | 'interrupted';
      tokenUsage?: Usage;
    }
  | {
      workspace: string;
      sessionId: string;
      type: 'todo-updated';
      todos: TodoItem[];
    };

/** @deprecated 使用 AgentSystemEvent。 */
export type BusEvent = AgentSystemEvent;
