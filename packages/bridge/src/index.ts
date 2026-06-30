export { AgentClient } from './client.js';
export { parseSSEStream, parseAgentStreamEvent } from './sse.js';
export { createSSEResponse } from './response.js';
export type {
  RunRequest,
  SessionSummary,
  InterruptRequest,
  ResetRequest,
  ServerStreamEvent,
} from './types.js';
export type { SSEEvent } from './sse.js';
export type { AgentStreamChunk, ModelMessage, ServerMessage } from 'rem-agent-core';

export { reduceStreamChunk } from './stream-reducer.js';
export type { StreamPart } from './stream-reducer.js';

export { AgentService } from './agent.js';
export type { RunParams, RunResult, InterruptResult, ResetResult } from './agent.js';
export { SessionService } from './sessions.js';
export { ServiceError } from './errors.js';
