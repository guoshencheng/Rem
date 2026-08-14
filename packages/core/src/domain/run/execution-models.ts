import type { Message } from '@earendil-works/pi-ai';
import type { JsonValue } from '../json/types.js';

export type ExecutionNodeKind = 'root' | 'organizer' | 'member' | 'delegated';
export type ExecutionNodeStatus = 'queued' | 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface RunExecutionNode {
  nodeId: string;
  runId: string;
  tenantId: string;
  parentNodeId?: string;
  kind: ExecutionNodeKind;
  role: string;
  agentId: string;
  agentRevision: string;
  status: ExecutionNodeStatus;
  depth: number;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  updatedAt: Date;
}

export type ExecutionEntryAudience = 'public' | 'organizer' | 'internal';

export interface RunExecutionEntry {
  entryId: string;
  tenantId: string;
  runId: string;
  nodeId: string;
  sequence: number;
  kind: 'message' | 'tool-result' | 'control';
  message?: Message;
  data?: JsonValue;
  audience: ExecutionEntryAudience;
  visibility: 'session' | 'run';
  createdAt: Date;
}

export type DeliveryKind = 'message' | 'resume';
export type DeliveryStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface RunDelivery {
  deliveryId: string;
  tenantId: string;
  runId: string;
  nodeId: string;
  kind: DeliveryKind;
  batchId: string;
  depth: number;
  status: DeliveryStatus;
  requestedByNodeId?: string;
  sourceEntryId?: string;
  resultEntryId?: string;
  attempt: number;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Internal durable counters used to enforce a Run's frozen execution limits. */
export interface RunExecutionBudget {
  tenantId: string;
  runId: string;
  agentRuns: number;
  messages: number;
  tokens: number;
  updatedAt: Date;
}

export type ToolInvocationResolution =
  | { action: 'confirm-succeeded'; result: { output: string; details?: JsonValue }; idempotencyKey: string }
  | { action: 'retry'; idempotencyKey: string }
  | { action: 'fail'; idempotencyKey: string };

export interface RunListOptions {
  sessionId?: string;
  status?: ExecutionNodeStatus;
  cursor?: string;
  limit?: number;
}

export interface ExecutionEntryListOptions {
  afterSequence?: number;
  limit?: number;
}
