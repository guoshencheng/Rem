import type { ApprovalDecision, ApprovalRequest } from 'rem-agent-core';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';

export interface IAgentService {
  init(): Promise<void>;

  // Workspace management
  listWorkspaces(): Promise<Workspace[]>;
  addWorkspace(path: string, name?: string): Promise<Workspace>;
  removeWorkspace(path: string): Promise<void>;

  // Session operations now require workspace
  run(workspace: string, sessionId: string, input: string): Promise<void>;
  interrupt(workspace: string, sessionId: string): Promise<void>;
  reset(workspace: string, sessionId: string): Promise<void>;
  createSession(workspace: string): Promise<SessionSummary>;
  listSessions(workspace: string): Promise<SessionSummary[]>;
  getMessages(workspace: string, sessionId: string): Promise<UIMessage[]>;
  updateSession(workspace: string, sessionId: string, updates: SessionUpdate): Promise<void>;
  deleteSession(workspace: string, sessionId: string): Promise<void>;
  stream(workspace: string): AsyncIterable<BusEvent>;
  listPendingApprovals(workspace: string, sessionId: string): Promise<ApprovalRequest[]>;
  resolveApproval(workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean>;
}
