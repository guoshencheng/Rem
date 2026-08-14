import type { AgentDefinition } from '../domain/agent-definition/types.js';
import type { RunLiveSignalDraft } from '../domain/event/live-signals.js';
import type { RunExecutionNode } from '../domain/run/execution-models.js';
import type { AgentRun } from '../domain/run/types.js';
import type { AgentSession } from '../domain/session/types.js';
import type { RuntimeStorage } from '../sdk/runtime-storage.js';
import type { ToolContext } from '../sdk/tool-provider.js';
import type { RunExecutionResult } from './run-executor.js';
import type { RuntimeDelegateTaskInput } from './runtime-delegate-tool.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { generateId } from '../shared/generate-id.js';
import { runtimeDeliveryId, updateNodeDelivery } from './runtime-delivery-state.js';
import { consumeExecutionAgentRun } from './run-execution-budget.js';
import { readNodeJournal } from './run-execution-journal-reader.js';
import { appendRunExecutionControlEntry } from './run-execution-journal.js';

export interface RuntimeChildDelegationOptions {
  storage: RuntimeStorage;
  parentRun: AgentRun;
  session: AgentSession;
  definition: AgentDefinition;
  input: RuntimeDelegateTaskInput;
  context: ToolContext;
  depth: number;
  emitSignal: (signal: RunLiveSignalDraft) => void;
  execute: (input: {
    run: AgentRun; session: AgentSession; signal: AbortSignal; definitionOverride: AgentDefinition;
    delegationDepth: number; emitSignal: (signal: RunLiveSignalDraft) => void; maxTurnsOverride?: number;
  }) => Promise<RunExecutionResult>;
}

export async function executeRuntimeChild(options: RuntimeChildDelegationOptions): Promise<{ output: string; details?: unknown }> {
  if (options.context.signal?.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
  const childDepth = options.depth + 1;
  const rootMaxDepth = options.parentRun.executionPlanSnapshot?.limits.maxDepth ?? 3;
  const definitionMaxDepth = options.definition.execution.delegation?.maxDepth ?? 3;
  const maxDepth = Math.min(rootMaxDepth, definitionMaxDepth);
  if (childDepth > maxDepth) {
    throw new RuntimeError('RUN_CONFLICT', 'Delegation depth is exhausted', false, {
      reason: 'maxDepth', max: maxDepth, actual: childDepth,
    });
  }
  const maxAgentRuns = options.parentRun.executionPlanSnapshot?.limits.maxAgentRuns;
  const parentNodeId = options.parentRun.rootNodeId ?? `${options.parentRun.runId}:root`;
  const invocationKey = options.context.invocationId ?? generateId();
  const nodeId = `${options.parentRun.runId}:delegated:${encodeURIComponent(parentNodeId)}:${encodeURIComponent(invocationKey)}`;
  const at = new Date();
  const existing = await options.storage.transaction((uow) => {
    const current = uow.executionNodes.get(nodeId);
    if (current) return current;
    if (maxAgentRuns !== undefined) consumeExecutionAgentRun(uow, options.parentRun, at);
    uow.executionNodes.insert({
      nodeId, runId: options.parentRun.runId, tenantId: options.parentRun.tenantId,
      parentNodeId, kind: 'delegated', role: 'delegated',
      agentId: options.parentRun.agentId, agentRevision: options.parentRun.agentRevision, status: 'queued', depth: childDepth,
      createdAt: new Date(at.getTime()), updatedAt: new Date(at.getTime()),
    } satisfies RunExecutionNode);
    uow.deliveries.insert({
      deliveryId: runtimeDeliveryId(options.parentRun.runId, nodeId), tenantId: options.parentRun.tenantId,
      runId: options.parentRun.runId, nodeId, kind: 'message', batchId: `${options.parentRun.runId}:delegation:${nodeId}`,
      depth: childDepth, status: 'queued', attempt: 0, createdAt: new Date(at.getTime()), updatedAt: new Date(at.getTime()),
    });
    return null;
  });
  if (existing?.status === 'completed') return readCompletedChild(options.storage, options.parentRun, nodeId);
  if (existing?.status === 'failed' || existing?.status === 'cancelled') return { output: 'Child agent failed', details: { status: existing.status } };
  if (existing?.status === 'waiting') {
    const unresolved = await options.storage.transaction((uow) => uow.toolInvocations.listByRun(options.parentRun.runId)
      .some((invocation) => invocation.nodeId === nodeId && invocation.status === 'unknown'));
    if (unresolved) throw new RuntimeError('TOOL_RESULT_UNKNOWN', 'Delegated child has an unknown result');
  }
  const childRun: AgentRun = {
    ...options.parentRun, rootNodeId: nodeId, trigger: { type: 'message', content: options.input.task }, status: 'running',
  };
  const { outputSchema: _outputSchema, ...withoutOutputSchema } = options.definition;
  const childExecution = options.definition.execution.type === 'single-agent'
    ? { type: 'single-agent' as const, ...(options.definition.execution.delegation === undefined ? {} : { delegation: options.definition.execution.delegation }) }
    : { type: 'single-agent' as const };
  const childDefinition: AgentDefinition = {
    ...withoutOutputSchema, ...(options.input.systemPrompt === undefined ? {} : { instructions: options.input.systemPrompt }),
    execution: childExecution,
  };
  await setNode(options.storage, options.parentRun.runId, nodeId, 'running', at);
  try {
    const result = await options.execute({
      run: childRun, session: structuredClone(options.session),
      signal: options.context.signal ?? new AbortController().signal,
      definitionOverride: childDefinition, delegationDepth: options.depth + 1, emitSignal: options.emitSignal,
      ...(options.input.maxTurns === undefined ? {} : { maxTurnsOverride: options.input.maxTurns }),
    });
    const artifact = result.artifacts.find((candidate) => candidate.type === 'result');
    await finishNode(options.storage, options.parentRun, nodeId, 'completed', new Date(), options.context.principalId ?? options.parentRun.principalId);
    return { output: typeof artifact?.data === 'string' ? artifact.data : 'Child agent completed' };
  } catch (error) {
    if (error instanceof RuntimeError && error.code === 'TOOL_RESULT_UNKNOWN') {
      await setNode(options.storage, options.parentRun.runId, nodeId, 'waiting', new Date());
      throw error;
    }
    await finishNode(options.storage, options.parentRun, nodeId, 'failed', new Date(), options.context.principalId ?? options.parentRun.principalId);
    if (error instanceof RuntimeError && error.code === 'EXECUTION_CANCELLED') throw error;
    return { output: 'Child agent failed', details: { status: 'failed' } };
  }
}

async function readCompletedChild(storage: RuntimeStorage, parentRun: AgentRun, nodeId: string): Promise<{ output: string; details?: unknown }> {
  return storage.transaction((uow) => {
    const message = readNodeJournal(uow, parentRun.runId, nodeId).reverse().find((entry) => entry.message?.role === 'assistant')?.message;
    if (!message || message.role !== 'assistant') return { output: 'Child agent completed' };
    const output = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
    return { output: output || 'Child agent completed' };
  });
}

async function setNode(storage: RuntimeStorage, runId: string, nodeId: string, status: RunExecutionNode['status'], at: Date): Promise<void> {
  await storage.transaction((uow) => {
    const current = uow.executionNodes.get(nodeId);
    if (!current) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Delegated execution node is missing', true);
    uow.executionNodes.update({ ...current, status, ...(status === 'running' ? { startedAt: new Date(at.getTime()) } : {}), ...(status === 'completed' || status === 'failed' ? { finishedAt: new Date(at.getTime()) } : {}), updatedAt: new Date(at.getTime()) });
    updateNodeDelivery(uow, runId, nodeId, status, at);
  });
}

async function finishNode(storage: RuntimeStorage, run: AgentRun, nodeId: string, status: 'completed' | 'failed', at: Date, principalId: string): Promise<void> {
  await storage.transaction((uow) => {
    const current = uow.executionNodes.get(nodeId);
    if (!current) throw new RuntimeError('STORAGE_UNAVAILABLE', 'Delegated execution node is missing', true);
    uow.executionNodes.update({ ...current, status, finishedAt: new Date(at.getTime()), updatedAt: new Date(at.getTime()) });
    updateNodeDelivery(uow, run.runId, nodeId, status, at);
    const resultEntry = status === 'completed'
      ? readNodeJournal(uow, run.runId, nodeId).reverse().find((entry) => entry.message?.role === 'assistant' && entry.message.stopReason !== 'toolUse')
      : undefined;
    const delivery = uow.deliveries.get(runtimeDeliveryId(run.runId, nodeId));
    if (delivery && resultEntry) uow.deliveries.update({ ...delivery, resultEntryId: resultEntry.entryId, updatedAt: new Date(at.getTime()) });
    appendRunExecutionControlEntry(uow, run, { action: status === 'completed' ? 'child-completed' : 'child-failed', nodeId, principalId, ...(status === 'failed' ? { errorCode: 'MODEL_EXECUTION_FAILED' } : {}) }, at, undefined, nodeId);
  });
}
