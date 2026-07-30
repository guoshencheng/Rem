import type { UserInputContent } from 'rem-agent-core';
import type { AgentStreamEvent, BusEvent, SessionActivity, Usage } from 'rem-agent-core';
import type { SessionInfo, WorkspaceRecord } from 'rem-agent-core';

export type { BusEvent, SessionActivity, Usage };
export type { UIMessage, UiContentBlock, ToolResultBlock, SessionUpdate } from 'rem-agent-core';

export type SessionSummary = SessionInfo;
export type Workspace = WorkspaceRecord;

export interface RunRequest {
  sessionId: string;
  content: UserInputContent;
}

export interface InterruptRequest {
  sessionId: string;
}

export interface ResetRequest {
  sessionId: string;
}

export interface AddWorkspaceRequest {
  path: string;
}

export interface RemoveWorkspaceRequest {
  path: string;
}

export type ServerStreamEvent = AgentStreamEvent;
