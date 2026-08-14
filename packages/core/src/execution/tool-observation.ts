import type { ToolInvocation } from '../domain/run/types.js';
import type { RuntimeObservationSink } from '../sdk/runtime-observer.js';
import type { RuntimeErrorCode } from '../domain/error/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export function observeTool(
  sink: RuntimeObservationSink | undefined,
  phase: 'started' | 'completed' | 'failed' | 'unknown',
  invocation: ToolInvocation,
  durationMs?: number,
  errorCode?: RuntimeErrorCode,
): void {
  sink?.({
    type: `tool.${phase}`, occurredAt: new Date(), tenantId: invocation.tenantId, sessionId: invocation.sessionId,
    runId: invocation.runId, nodeId: invocation.nodeId, invocationId: invocation.invocationId,
    toolCallId: invocation.toolCallId, toolName: invocation.toolName, sideEffect: invocation.sideEffect,
    ...(durationMs === undefined ? {} : { durationMs }), ...(errorCode === undefined ? {} : { errorCode }),
  });
}

export function observeToolSettlementFailure(
  sink: RuntimeObservationSink | undefined, invocation: ToolInvocation, startedAt: number, error: unknown,
): void {
  const unknown = error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED';
  observeTool(sink, unknown ? 'unknown' : 'failed', invocation, Date.now() - startedAt,
    unknown ? 'EXECUTION_CANCELLED' : 'TOOL_EXECUTION_FAILED');
}
