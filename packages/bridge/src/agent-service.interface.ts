import type { AgentStreamChunk } from 'rem-agent-core';
import type { SessionSummary, UIMessage } from './types.js';

export interface IAgentService {
  run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;
  interrupt(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  getMessages(sessionId: string): Promise<UIMessage[]>;
}
