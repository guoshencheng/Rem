import type { RuntimeErrorCode } from '../application/runtime/runtime-error.js';
import type { Artifact } from '../domain/artifact/types.js';
import type { RunEvent } from '../domain/event/types.js';
import type { AgentRun, WorkItem } from '../domain/run/types.js';
import type { AgentSession, RuntimeSessionEntry } from '../domain/session/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../sdk/runtime-storage.js';
import type { ResolvedLocalRunWorkerOptions } from './local-worker-options.js';
import type { ValidatedRunOutput } from './run-output-validation.js';
import { isTerminalRunStatus, transitionRun } from '../domain/run/run-state.js';
import { nextWorkerId, readWorkerNow } from './local-worker-options.js';
import { appendEvent, finishWaiting, finishWork, hasUnknownInvocation } from './run-completion-events.js';
import { cloneDate, finishExecutionGraph, updateRootExecutionNode } from './run-completion-node.js';
import { finishFailedRun, ownsLease, readOwnedState } from './run-completion-state.js';
import { projectRunJournalToSession } from './run-session-projection.js';

export type ClaimedRunStart =
  | { kind: 'execute'; run: AgentRun; session: AgentSession }
  | { kind: 'skip' };

export interface RunFailure {
  code: RuntimeErrorCode;
  retryable: boolean;
  cancelled?: boolean;
}

export class RunCompletion {
  constructor(
    private readonly storage: RuntimeStorage,
    private readonly options: ResolvedLocalRunWorkerOptions,
  ) {}

  start(claimed: WorkItem): Promise<ClaimedRunStart> {
    const at = readWorkerNow(this.options.now);
    const committed: RunEvent[] = [];
    return this.storage.transaction((uow): ClaimedRunStart => {
      const liveWork = uow.workItems.getByRun(claimed.runId);
      if (!liveWork) throw new Error('Claimed work item is missing');
      if (!ownsLease(liveWork, claimed, this.options.owner, at)) return { kind: 'skip' };
      const run = uow.runs.get(claimed.runId);
      if (!run) {
        uow.workItems.update(finishWork(liveWork, 'failed', at));
        return { kind: 'skip' };
      }
      if (isTerminalRunStatus(run.status)) {
        uow.workItems.update(finishWork(liveWork, run.status === 'completed' ? 'completed' : 'failed', at));
        return { kind: 'skip' };
      }
      if (run.status === 'running' && hasUnknownInvocation(uow, run.runId)) {
        finishWaiting(uow, run, liveWork, at, this.options, committed);
        return { kind: 'skip' };
      }
      if (run.cancellationRequestedAt) {
        finishFailedRun(uow, run, liveWork, { code: 'EXECUTION_CANCELLED', retryable: false, cancelled: true }, at, this.options, committed);
        return { kind: 'skip' };
      }
      if (run.status === 'waiting') {
        uow.workItems.update(finishWork(liveWork, 'failed', at));
        return { kind: 'skip' };
      }
      if (run.status === 'running') {
        // 重启恢复已在 initialize 完成（recover-runtime.ts）；此处仅剩运行期 lease 被接管，
        // 副作用不确定的执行绝不重放。
        finishFailedRun(uow, run, liveWork, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options, committed);
        return { kind: 'skip' };
      }
      if (run.status !== 'queued') {
        finishFailedRun(uow, run, liveWork, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options, committed);
        return { kind: 'skip' };
      }
      const running: AgentRun = {
        ...run, status: transitionRun(run.status, 'running'), startedAt: cloneDate(at), updatedAt: cloneDate(at),
      };
      uow.runs.update(running);
      updateRootExecutionNode(uow, running, 'running', at);
      appendEvent(uow, running, 'run.started', { attempt: liveWork.attempt }, at, this.options, committed);
      const session = uow.sessions.get(running.sessionId);
      if (!session || session.tenantId !== running.tenantId) {
        finishFailedRun(uow, running, liveWork, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options, committed);
        return { kind: 'skip' };
      }
      return { kind: 'execute', run: structuredClone(running), session: structuredClone(session) };
    }).then((result) => {
      this.emitCommitted(committed);
      return result;
    });
  }

  succeed(claimed: WorkItem, output: ValidatedRunOutput): Promise<boolean> {
    const at = readWorkerNow(this.options.now);
    const committed: RunEvent[] = [];
    return this.storage.transaction((uow) => {
      const state = readOwnedState(uow, claimed, this.options.owner, at);
      if (!state) return false;
      const { run, work } = state;
      if (isTerminalRunStatus(run.status)) return false;
      if (run.status !== 'running') return false;
      if (hasUnknownInvocation(uow, run.runId)) {
        finishWaiting(uow, run, work, at, this.options, committed);
        return true;
      }
      if (run.cancellationRequestedAt) {
        finishFailedRun(uow, run, work, { code: 'EXECUTION_CANCELLED', retryable: false, cancelled: true }, at, this.options, committed);
        return true;
      }
      const session = uow.sessions.get(run.sessionId);
      if (!session || session.tenantId !== run.tenantId) {
        finishFailedRun(uow, run, work, { code: 'INTERNAL_ERROR', retryable: false }, at, this.options, committed);
        return true;
      }
      let sequence = uow.sessions.nextEntrySequence(session.sessionId) - 1;
      let completedArtifactId: string | undefined;
      const entries: RuntimeSessionEntry[] = output.journaled
        ? projectRunJournalToSession(uow, run, at, this.options.generateId)
        : output.sessionEntries.map((entry) => ({
          entryId: nextWorkerId(this.options.generateId), tenantId: run.tenantId,
          sessionId: run.sessionId, runId: run.runId, sequence: ++sequence,
          message: structuredClone(entry.message),
          ...(entry.metadata === undefined ? {} : { metadata: structuredClone(entry.metadata) }),
          createdAt: cloneDate(at),
        }));
      if (entries.length) uow.sessions.appendEntries(entries);
      if (!output.journaled) {
        let executionSequence = uow.executionEntries.nextSequence(run.runId) - 1;
        for (const entry of output.sessionEntries) {
          uow.executionEntries.append({
            entryId: nextWorkerId(this.options.generateId), tenantId: run.tenantId, runId: run.runId,
            nodeId: run.rootNodeId ?? `${run.runId}:root`, sequence: ++executionSequence,
            kind: entry.message.role === 'toolResult' ? 'tool-result' : 'message', message: structuredClone(entry.message),
            audience: run.executionType === 'team' ? 'internal' : 'public', visibility: 'run', createdAt: cloneDate(at),
          });
        }
      }
      for (const draft of output.artifacts) {
        const artifact: Artifact = {
          artifactId: nextWorkerId(this.options.generateId), tenantId: run.tenantId,
          sessionId: run.sessionId, runId: run.runId, ...structuredClone(draft), createdAt: cloneDate(at),
        };
        uow.artifacts.insert(artifact);
        if (completedArtifactId === undefined && artifact.type === 'result') completedArtifactId = artifact.artifactId;
        appendEvent(uow, run, 'artifact.created', {
          artifactId: artifact.artifactId, type: artifact.type, mediaType: artifact.mediaType, name: artifact.name,
        }, at, this.options, committed);
      }
      const completed: AgentRun = {
        ...run, status: transitionRun(run.status, 'completed'), finishedAt: cloneDate(at), updatedAt: cloneDate(at),
        ...(completedArtifactId === undefined ? {} : { primaryArtifactId: completedArtifactId }),
      };
      uow.runs.update(completed);
      updateRootExecutionNode(uow, completed, 'completed', at);
      finishExecutionGraph(uow, completed.runId, 'completed', at);
      appendEvent(uow, completed, 'run.completed', {
        sessionEntryCount: entries.length, artifactCount: output.artifacts.length,
      }, at, this.options, committed);
      uow.workItems.update(finishWork(work, 'completed', at));
      return true;
    }).then((result) => {
      this.emitCommitted(committed);
      return result;
    });
  }

  fail(claimed: WorkItem, failure: RunFailure): Promise<boolean> {
    const at = readWorkerNow(this.options.now);
    const committed: RunEvent[] = [];
    return this.storage.transaction((uow) => {
      const state = readOwnedState(uow, claimed, this.options.owner, at);
      if (!state || isTerminalRunStatus(state.run.status)) return false;
      if (state.run.status === 'waiting') {
        uow.workItems.update(finishWork(state.work, 'failed', at));
        return true;
      }
      const cancelled = state.run.cancellationRequestedAt !== undefined || failure.cancelled;
      if (state.run.status === 'running' && hasUnknownInvocation(uow, state.run.runId)) {
        finishWaiting(uow, state.run, state.work, at, this.options, committed);
        return true;
      }
      finishFailedRun(uow, state.run, state.work, cancelled
        ? { code: 'EXECUTION_CANCELLED', retryable: false, cancelled: true }
        : failure, at, this.options, committed);
      return true;
    }).then((result) => {
      this.emitCommitted(committed);
      return result;
    });
  }

  private emitCommitted(events: RunEvent[]): void {
    const emit = this.options.onEventCommitted;
    if (!emit) return;
    for (const event of events) emit(event);
  }
}
