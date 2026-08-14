import type { ToolInvocation } from '../domain/run/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import { assertToolNotAborted } from './tool-execution-control.js';

interface PersistenceContext {
  storage: RuntimeStorage;
  invocation: ToolInvocation;
  now: () => Date;
  event: (sequence: number, type: string, data: unknown) => RunEvent;
}

export function finishRecordedTool(context: PersistenceContext, status: 'succeeded' | 'failed', result: unknown, error: string | undefined, eventType: string, errorCode?: string): Promise<void> {
  const updatedAt = context.now();
  return context.storage.transaction((uow) => {
    const invocation = context.invocation;
    uow.toolInvocations.update({ ...invocation, status, result, error, updatedAt });
    uow.events.append(context.event(uow.events.nextSequence(invocation.runId), eventType, {
      invocationId: invocation.invocationId, toolCallId: invocation.toolCallId, toolName: invocation.toolName,
      ...(errorCode === undefined ? {} : { errorCode }),
    }));
  });
}

export function finishRecordedToolSuccess(context: PersistenceContext, result: unknown, signal?: AbortSignal): Promise<void> {
  const updatedAt = context.now();
  return context.storage.transaction((uow) => {
    assertToolNotAborted(signal);
    const invocation = context.invocation;
    uow.toolInvocations.update({ ...invocation, status: 'succeeded', result, updatedAt });
    uow.events.append(context.event(uow.events.nextSequence(invocation.runId), 'tool.succeeded', {
      invocationId: invocation.invocationId, toolCallId: invocation.toolCallId, toolName: invocation.toolName,
    }));
  });
}

export function markRecordedToolUnknown(context: PersistenceContext, reason: string): Promise<void> {
  const updatedAt = context.now();
  return context.storage.transaction((uow) => {
    const invocation = context.invocation;
    uow.toolInvocations.update({ ...invocation, status: 'unknown', error: 'Tool result is unknown', updatedAt });
    uow.events.append(context.event(uow.events.nextSequence(invocation.runId), 'tool.result_unknown', {
      invocationId: invocation.invocationId, toolCallId: invocation.toolCallId,
      toolName: invocation.toolName, errorCode: reason, reason: 'execution-aborted',
    }));
  });
}
