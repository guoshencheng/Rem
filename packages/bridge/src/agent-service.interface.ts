import type { AgentStreamChunk, ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage } from './types.js';

export interface IAgentService {
  run(sessionId: string, input: string): Promise<AsyncIterable<AgentStreamChunk>>;
  interrupt(sessionId: string): Promise<void>;
  reset(sessionId: string): Promise<void>;
  createSession(): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  getMessages(sessionId: string): Promise<UIMessage[]>;
  updateSession(sessionId: string, updates: SessionUpdate): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  stream(): AsyncIterable<BusEvent>;
  listPendingApprovals(sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
