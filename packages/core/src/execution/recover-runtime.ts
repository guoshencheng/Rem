import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, ToolInvocation, WorkItem } from '../domain/run/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import { transitionRun } from '../domain/run/run-state.js';
import { nextWorkerId, readWorkerNow } from './local-worker-options.js';

export interface RuntimeRecoveryOptions {
  now: () => Date;
  generateId: () => string;
  onEventCommitted?: (event: RunEvent) => void;
}

/**
 * 重启恢复审计：把崩溃残留状态收敛为可重新调度或等待人工处理。
 * 每个 WorkItem 的状态变更与事件在同一事务提交，事件序号由 Event Repository 分配。
 */
export async function recoverInterruptedRuns(
  storage: RuntimeStorage,
  options: RuntimeRecoveryOptions,
): Promise<void> {
  const at = readWorkerNow(options.now);
  const recoverable = await storage.listRecoverableWorkItems(at);
  for (const item of recoverable) {
    const committed: RunEvent[] = [];
    await storage.transaction((uow) => recoverWorkItem(uow, item.runId, at, options, committed));
    for (const event of committed) options.onEventCommitted?.(event);
  }
}

function recoverWorkItem(
  uow: RuntimeUnitOfWork,
  runId: string,
  at: Date,
  options: RuntimeRecoveryOptions,
  committed: RunEvent[],
): void {
  const work = uow.workItems.getByRun(runId);
  if (!work) return;
  const run = uow.runs.get(runId);
  if (!run || run.status === 'queued') { requeueWork(uow, work, at); return; }
  // waiting 等待人工处理、terminal 由 Worker start 路径收尾；两者都不重新排队执行。
  if (run.status === 'waiting') { uow.workItems.update(finishWork(work, at)); return; }
  if (run.status !== 'running') return;

  const executing = uow.toolInvocations.listByRun(runId)
    .filter((invocation) => invocation.status === 'executing');
  if (executing.some((invocation) => !isRetryable(invocation))) {
    markUnknown(uow, run, work, executing, at, options, committed);
    return;
  }
  // 没有 executing 或有但可安全重试（none/idempotent/支持幂等键）：标记回 planned 并重排 Run。
  for (const invocation of executing) {
    uow.toolInvocations.update({ ...invocation, status: 'planned', updatedAt: cloneDate(at) });
  }
  // 恢复重排不是正常业务迁移（run-state.ts 不放行 running->queued），由恢复路径专用直写。
  const requeued: AgentRun = { ...run, status: 'queued', updatedAt: cloneDate(at) };
  uow.runs.update(requeued);
  appendEvent(uow, requeued, 'run.requeued', { reason: 'recovery' }, at, options, committed);
  requeueWork(uow, work, at);
}

function markUnknown(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  work: WorkItem,
  executing: ToolInvocation[],
  at: Date,
  options: RuntimeRecoveryOptions,
  committed: RunEvent[],
): void {
  for (const invocation of executing) {
    uow.toolInvocations.update({
      ...invocation, status: 'unknown', error: 'Tool result is unknown', updatedAt: cloneDate(at),
    });
    appendEvent(uow, run, 'tool.result_unknown', {
      invocationId: invocation.invocationId, toolCallId: invocation.toolCallId,
      toolName: invocation.toolName, reason: 'recovery',
    }, at, options, committed);
  }
  const waiting: AgentRun = {
    ...run, status: transitionRun(run.status, 'waiting'), waitingReason: 'recovery', updatedAt: cloneDate(at),
  };
  uow.runs.update(waiting);
  appendEvent(uow, waiting, 'run.waiting', { waitingReason: 'recovery' }, at, options, committed);
  // 副作用不确定，不得再次调度；WorkItem 收尾为 failed 使其不再可被 claim。
  uow.workItems.update(finishWork(work, at));
}

const isRetryable = (invocation: ToolInvocation): boolean =>
  invocation.sideEffect !== 'non-idempotent' || invocation.supportsIdempotencyKey;

function requeueWork(uow: RuntimeUnitOfWork, work: WorkItem, at: Date): void {
  if (work.status !== 'leased') return;
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  uow.workItems.update({ ...rest, status: 'queued', updatedAt: cloneDate(at) });
}

function finishWork(work: WorkItem, at: Date): WorkItem {
  const { leaseOwner: _owner, leaseExpiresAt: _expiry, ...rest } = work;
  return { ...rest, status: 'failed', updatedAt: cloneDate(at) };
}

function appendEvent(
  uow: RuntimeUnitOfWork,
  run: AgentRun,
  type: string,
  data: unknown,
  at: Date,
  options: RuntimeRecoveryOptions,
  committed: RunEvent[],
): void {
  const event: RunEvent = {
    eventId: nextWorkerId(options.generateId), sequence: uow.events.nextSequence(run.runId),
    schemaVersion: 1, tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId,
    type, data: structuredClone(data), occurredAt: cloneDate(at),
  };
  uow.events.append(event);
  committed.push(event);
}

const cloneDate = (value: Date): Date => new Date(value.getTime());
