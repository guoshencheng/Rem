import type { ResolvedContextSnapshot } from '../context/types.js';
import type { UserMessageContent } from './message-trigger-content.js';

export type RunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export type RunTrigger =
  | { type: 'message'; content: UserMessageContent }
  | { type: 'task'; input: unknown };

export interface AgentRun {
  runId: string;
  tenantId: string;
  principalId: string;
  sessionId: string;
  agentId: string;
  agentRevision: string;
  status: RunStatus;
  trigger: RunTrigger;
  contextSnapshot: ResolvedContextSnapshot;
  waitingReason?: 'recovery';
  errorCode?: string;
  cancellationRequestedAt?: Date;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  updatedAt: Date;
}

export interface WorkItem {
  workItemId: string;
  runId: string;
  status: 'queued' | 'leased' | 'completed' | 'failed';
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  attempt: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolInvocation {
  invocationId: string;
  tenantId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  status: 'planned' | 'executing' | 'succeeded' | 'failed' | 'unknown';
  sideEffect: 'none' | 'idempotent' | 'non-idempotent';
  supportsIdempotencyKey: boolean;
  input: unknown;
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
