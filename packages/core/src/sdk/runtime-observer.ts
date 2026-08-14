import type { RuntimeErrorCode } from '../domain/error/types.js';
import type { RunStatus } from '../domain/run/types.js';

export interface RuntimeObservationBase {
  occurredAt: Date;
  tenantId?: string;
  sessionId?: string;
  runId?: string;
  nodeId?: string;
  agentId?: string;
}

export type RuntimeObservation =
  | (RuntimeObservationBase & { type: 'runtime.initializing' | 'runtime.ready' | 'runtime.shutdown' | 'runtime.initialize.failed'; errorCode?: RuntimeErrorCode })
  | (RuntimeObservationBase & { type: 'run.created' | 'run.started' | 'run.requeued' | 'run.waiting' | 'run.completed' | 'run.failed' | 'run.cancelled'; status?: RunStatus; errorCode?: RuntimeErrorCode; waitingReason?: string; attempt?: number })
  | (RuntimeObservationBase & { type: 'model.started' | 'model.completed' | 'model.failed'; provider: string; model: string; durationMs?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number; httpStatus?: number; errorCode?: RuntimeErrorCode; diagnostic?: string })
  | (RuntimeObservationBase & { type: 'tool.started' | 'tool.completed' | 'tool.failed' | 'tool.unknown'; invocationId: string; toolCallId: string; toolName: string; sideEffect: 'none' | 'idempotent' | 'non-idempotent'; durationMs?: number; errorCode?: RuntimeErrorCode })
  | (RuntimeObservationBase & { type: 'worker.poll.failed' | 'worker.lease.failed' | 'worker.recovery.failed'; errorCode: RuntimeErrorCode; retryable: boolean });

export interface RuntimeObserver {
  observe(event: RuntimeObservation): void | PromiseLike<void>;
}

export type RuntimeObservationSink = (event: RuntimeObservation) => void;
