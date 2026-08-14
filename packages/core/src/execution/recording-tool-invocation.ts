import type { AgentRun, ToolInvocation } from '../domain/run/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { ToolCall, ToolContext, ToolDefinition, ToolResult } from '../sdk/tool-provider.js';
import { cloneCanonicalJson } from '../application/contexts/canonical-json.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { assertToolNotAborted } from './tool-execution-control.js';

export interface InvocationPlanOptions {
  storage: RuntimeStorage;
  run: AgentRun;
  call: ToolCall;
  input: unknown;
  definition: ToolDefinition;
  context: ToolContext;
  now: () => Date;
  generateId: () => string;
  event: (sequence: number, type: string, data: unknown) => RunEvent;
}

export type InvocationPlan = { existing: boolean; invocation: ToolInvocation };

export async function findOrPlanInvocation(options: InvocationPlanOptions): Promise<InvocationPlan> {
  return options.storage.transaction((uow) => {
    assertToolNotAborted(options.context.signal);
    const persisted = uow.toolInvocations.getByRunAndCall(options.run.runId, options.call.toolCallId, options.run.rootNodeId);
    if (persisted) return { existing: true, invocation: persisted };
    const createdAt = options.now();
    const invocation: ToolInvocation = {
      invocationId: options.generateId(), tenantId: options.run.tenantId, sessionId: options.run.sessionId,
      runId: options.run.runId, ...(options.run.rootNodeId === undefined ? {} : { nodeId: options.run.rootNodeId }), toolCallId: options.call.toolCallId, toolName: options.call.toolName,
      status: 'executing', sideEffect: options.definition.sideEffect ?? 'non-idempotent',
      supportsIdempotencyKey: options.definition.supportsIdempotencyKey === true,
      input: options.input, createdAt, updatedAt: createdAt,
    };
    uow.toolInvocations.insert({ ...invocation, status: 'planned' });
    uow.toolInvocations.update(invocation);
    uow.events.append(options.event(uow.events.nextSequence(invocation.runId), 'tool.started', {
      invocationId: invocation.invocationId, toolCallId: options.call.toolCallId, toolName: options.call.toolName,
    }));
    return { existing: false, invocation };
  });
}

export function validateExistingInput(existing: ToolInvocation, call: ToolCall, input: unknown): ToolInvocation {
  if (existing.toolName !== call.toolName) throw new RuntimeError('STORAGE_CONFLICT', 'Tool call name conflicts with the persisted invocation');
  let sameInput = false;
  try { sameInput = JSON.stringify(cloneCanonicalJson(existing.input)) === JSON.stringify(cloneCanonicalJson(input)); }
  catch { /* malformed persisted input is rejected by the comparison below */ }
  if (!sameInput) throw new RuntimeError('STORAGE_CONFLICT', 'Tool call input conflicts with the persisted invocation');
  return existing;
}

export function reuseSuccessfulInvocation(existing: ToolInvocation, call: ToolCall): ToolResult {
  try {
    const isolated = cloneCanonicalJson(existing.result, { omitUndefinedProperties: true });
    if (typeof isolated !== 'object' || isolated === null || Array.isArray(isolated)) throw new Error('Persisted tool result is invalid');
    const result = isolated as { output?: unknown; details?: unknown };
    if (typeof result.output !== 'string') throw new Error('Persisted tool result is invalid');
    return { toolCallId: call.toolCallId, toolName: call.toolName, output: result.output,
      ...(Object.hasOwn(result, 'details') ? { details: result.details } : {}) };
  } catch (cause) {
    // A terminal invocation is an execution fact. If its persisted result is
    // malformed, recovery must stop rather than guess or invoke the tool
    // again; callers can then surface a stable internal-corruption failure.
    throw new RuntimeError('INTERNAL_ERROR', 'Persisted tool result is invalid', false, undefined, { cause });
  }
}
