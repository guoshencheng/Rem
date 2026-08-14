import type { ToolCall, ToolContext, ToolProvider, ToolResult } from '../sdk/tool-provider.js';
import type { ToolInvocation } from '../domain/run/types.js';
import { raceToolSettlement } from './tool-execution-control.js';

export async function executeRecordedToolCall(
  provider: ToolProvider,
  call: ToolCall,
  context: ToolContext,
  invocation: ToolInvocation,
  idempotencyKey: string,
): Promise<{ kind: 'fulfilled'; value: ToolResult[] } | { kind: 'rejected'; error: unknown } | { kind: 'aborted' }> {
  const operation = provider.execute([call], {
    ...context,
    tenantId: invocation.tenantId,
    runId: invocation.runId,
    invocationId: invocation.invocationId,
    idempotencyKey,
  });
  return raceToolSettlement(operation, context.signal);
}
