export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
export { createSSEResponse, createBusSSEResponse } from './response.js';
export type {
  RunRequest,
  SessionSummary,
  SessionUpdate,
  InterruptRequest,
  ResetRequest,
  ServerStreamEvent,
  UIMessage,
  UiContentBlock,
  ToolResultBlock,
  BusEvent,
  SessionActivity,
  Workspace,
  AddWorkspaceRequest,
  RemoveWorkspaceRequest,
} from './types.js';
export type { SSEEvent } from './sse.js';
export type { AgentStreamEvent } from 'rem-agent-core';

export { reduceStreamEvent } from './stream-reducer.js';

export type { IAgentService } from './agent-service.interface.js';
export { AgentRemoteService } from './agent-remote-service.js';
export type { AgentRemoteServiceOptions } from './agent-remote-service.js';

export { ServiceError } from './errors.js';
export { BroadcastBus, createBroadcastBus } from './broadcast-bus.js';

// --- v2 服务层 ---
export { AgentsUniService } from './agents-uni-service.js';
export { AgentService, type AgentServiceDeps } from './agent-service.js';
export { SessionService } from './session-service.js';
export { WorkspaceService } from './workspace-service.js';
export { REMSession, type REMSessionStatus, type REMSessionParams } from './rem-session.js';
export { REMSessions } from './rem-sessions.js';
