import type { RunEvent } from '../domain/event/types.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';
import type { RuntimeErrorCode } from '../domain/error/types.js';
import { RUNTIME_ERROR_CODES } from '../domain/error/types.js';

const RUN_TYPES = new Set(['run.created', 'run.started', 'run.requeued', 'run.waiting', 'run.completed', 'run.failed', 'run.cancelled']);

export function observeRunEvent(sink: RuntimeObservationSink | undefined, event: RunEvent): void {
  if (!RUN_TYPES.has(event.type)) return;
  const data = record(event.data);
  const errorCode = safeErrorCode(data.errorCode);
  sink?.({
    type: event.type as 'run.created', occurredAt: new Date(event.occurredAt.getTime()),
    tenantId: event.tenantId, sessionId: event.sessionId, runId: event.runId,
    ...(typeof data.waitingReason === 'string' ? { waitingReason: data.waitingReason } : {}),
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

function safeErrorCode(value: unknown): RuntimeErrorCode | undefined {
  return typeof value === 'string' && RUNTIME_ERROR_CODES.includes(value as RuntimeErrorCode)
    ? value as RuntimeErrorCode : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
