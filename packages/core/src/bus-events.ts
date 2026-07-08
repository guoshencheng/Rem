import type { AgentStreamChunk, ContentPart } from './types.js';

export type SessionActivity =
  | 'idle'
  | 'pending'
  | 'thinking'
  | 'calling-function'
  | 'outputting';

export type BusEvent =
  | { workspace: string; sessionId: string; type: 'chunk'; chunk: AgentStreamChunk }
  | { workspace: string; sessionId: string; type: 'session-start' }
  | { workspace: string; sessionId: string; type: 'session-end' }
  | { workspace: string; sessionId: string; type: 'session-error'; error: string }
  | { workspace: string; sessionId: string; type: 'activity-change'; activity: SessionActivity }
  | { workspace: string; sessionId: string; type: 'snapshot'; messageId: string; parts: ContentPart[] }
  | { workspace: string; sessionId: string; type: 'usage-change'; usage: import('./types.js').LanguageModelUsage };
