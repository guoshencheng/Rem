import type { Artifact, Run, RunEvent, RunSignal, RuntimeSessionEntry, Session, RunExecutionNode, RunExecutionEntry, RunDelivery, RuntimeToolInvocation, RuntimeHealth } from 'rem-agent-core';
import { isRunLiveSignal, RUN_LIVE_SIGNAL_TYPES } from 'rem-agent-core/live-signals';
import { RUNTIME_ERROR_CODES } from './runtime-error-codes.js';

export function decodeRun(value: unknown): Run {
  const run = value as Run;
  return { ...run, createdAt: date(run.createdAt), updatedAt: date(run.updatedAt),
    startedAt: optionalDate(run.startedAt), finishedAt: optionalDate(run.finishedAt),
    cancellationRequestedAt: optionalDate(run.cancellationRequestedAt) };
}

export function decodeHealth(value: unknown): RuntimeHealth {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid runtime health');
  const health = value as Partial<RuntimeHealth>;
  const checks = health.checks;
  if (!['ready', 'degraded', 'stopped'].includes(String(health.status))
    || !(checks && typeof checks === 'object')
    || !['ready', 'not-ready', 'stopped'].includes(String(checks.runtime))
    || !['ok', 'error', 'unknown'].includes(String(checks.storage))
    || !['running', 'stopped'].includes(String(checks.worker))) {
    throw new TypeError('Invalid runtime health status');
  }
  const errorCode = health.errorCode;
  if (errorCode !== undefined && !RUNTIME_ERROR_CODES.includes(errorCode as typeof RUNTIME_ERROR_CODES[number])) throw new TypeError('Invalid runtime health error code');
  return {
    status: health.status as RuntimeHealth['status'], checkedAt: date(health.checkedAt),
    checks: { runtime: checks.runtime as RuntimeHealth['checks']['runtime'], storage: checks.storage as RuntimeHealth['checks']['storage'], worker: checks.worker as RuntimeHealth['checks']['worker'] },
    ...(errorCode === undefined ? {} : { errorCode: errorCode as RuntimeHealth['errorCode'] }),
  };
}

export function decodeSession(value: unknown): Session {
  const session = value as Session;
  return { ...session, createdAt: date(session.createdAt), updatedAt: date(session.updatedAt) };
}

export function decodeSessionEntry(value: unknown): RuntimeSessionEntry {
  const entry = value as RuntimeSessionEntry;
  return { ...entry, createdAt: date(entry.createdAt) };
}

export function decodeMessageCount(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid runtime message count');
  }
  return value;
}

export function decodeEvent(value: unknown): RunEvent {
  const event = value as RunEvent;
  return { ...event, occurredAt: date(event.occurredAt) };
}

export function decodeSignal(value: unknown): RunSignal {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid runtime signal');
  }
  const signal = value as Partial<RunSignal>;
  if (typeof signal.runId !== 'string' || typeof signal.type !== 'string') {
    throw new TypeError('Invalid runtime signal envelope');
  }
  const decoded: RunSignal = { ...signal, runId: signal.runId, type: signal.type, occurredAt: date(signal.occurredAt) };
  if (RUN_LIVE_SIGNAL_TYPES.includes(signal.type as typeof RUN_LIVE_SIGNAL_TYPES[number])) {
    if (!isRunLiveSignal(decoded)) throw new TypeError('Invalid runtime live signal payload');
  }
  return decoded;
}

export function decodeArtifact(value: unknown): Artifact {
  const artifact = value as Artifact;
  return { ...artifact, createdAt: date(artifact.createdAt) };
}

export function decodeExecutionNode(value: unknown): RunExecutionNode {
  const node = value as RunExecutionNode;
  return { ...node, createdAt: date(node.createdAt), updatedAt: date(node.updatedAt), startedAt: optionalDate(node.startedAt), finishedAt: optionalDate(node.finishedAt) };
}
export function decodeExecutionEntry(value: unknown): RunExecutionEntry { const entry = value as RunExecutionEntry; return { ...entry, createdAt: date(entry.createdAt) }; }
export function decodeDelivery(value: unknown): RunDelivery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid runtime delivery');
  const delivery = value as Partial<RunDelivery>;
  const statuses = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'] as const;
  if (typeof delivery.deliveryId !== 'string' || typeof delivery.runId !== 'string' || typeof delivery.nodeId !== 'string'
    || typeof delivery.kind !== 'string' || !['message', 'resume'].includes(delivery.kind)
    || typeof delivery.status !== 'string' || !(statuses as readonly string[]).includes(delivery.status)
    || !Number.isSafeInteger(delivery.attempt) || (delivery.attempt as number) < 0) {
    throw new TypeError('Invalid runtime delivery shape');
  }
  for (const field of ['requestedByNodeId', 'sourceEntryId', 'resultEntryId', 'errorCode'] as const) {
    if (delivery[field] !== undefined && typeof delivery[field] !== 'string') throw new TypeError(`Invalid runtime delivery ${field}`);
  }
  return { ...delivery, createdAt: date(delivery.createdAt), updatedAt: date(delivery.updatedAt) } as RunDelivery;
}
export function decodeToolInvocation(value: unknown): RuntimeToolInvocation {
  const invocation = value as RuntimeToolInvocation;
  return { ...invocation, createdAt: date(invocation.createdAt), updatedAt: date(invocation.updatedAt) };
}

function date(value: unknown): Date {
  const result = new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new TypeError('Invalid runtime date');
  return result;
}

function optionalDate(value: unknown): Date | undefined {
  return value === undefined || value === null ? undefined : date(value);
}
