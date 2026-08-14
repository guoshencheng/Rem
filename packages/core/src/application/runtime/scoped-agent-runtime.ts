import type { AgentDefinition } from '../../domain/agent-definition/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import { getScopedArtifact, getScopedRun, getScopedSession, listScopedDeliveries, listScopedExecutionEntries, listScopedExecutionNodes, listScopedRunArtifacts, listScopedRunEvents } from '../runs/run-queries.js';
import type { StartRunInput } from '../runs/types.js';
import { RuntimeError } from './runtime-error.js';
import { createRunSignalStream } from './run-signal-stream.js';
import { waitForRunCompletion } from './wait-for-completion.js';
import type { ScopedAgentRuntime, ScopedRuntimeDeps } from './types.js';
import { generateId } from '../../shared/generate-id.js';
import { patchSessionContexts } from '../sessions/patch-session-contexts.js';
import { ResolveToolInvocationUsecase } from '../runs/resolve-tool-invocation.js';
import { encodeRunCursor, InvalidRunCursorError } from '../../domain/run/run-cursor.js';
import { createTaskOperations } from '../tasks/task-operations.js';
import { RUNTIME_ERROR_CODES, type RuntimeErrorCode } from '../../domain/error/types.js';

export class ScopedAgentRuntimeImpl implements ScopedAgentRuntime {
  readonly tasks: ScopedAgentRuntime['tasks'];

  constructor(private readonly deps: ScopedRuntimeDeps) {
    this.tasks = createTaskOperations({
      context: this.deps.context,
      ensureReady: this.deps.ensureReady,
      storage: this.deps.storage,
      startRun: this.deps.startRun,
      signals: this.deps.signals,
      waitPollMs: this.deps.waitPollMs,
      observe: this.deps.observe,
    });
  }

  readonly agents: ScopedAgentRuntime['agents'] = {
    list: () => {
      this.deps.ensureReady();
      return this.deps.agentDefinitions.list();
    },
    get: async (agentId: string, revision?: string): Promise<AgentDefinition> => {
      this.deps.ensureReady();
      const definition = await this.deps.agentDefinitions.get(agentId, revision);
      if (!definition) {
        const code = revision === undefined ? 'AGENT_NOT_FOUND' : 'AGENT_REVISION_NOT_FOUND';
        throw new RuntimeError(code, `Agent definition not found: ${agentId}`);
      }
      return definition;
    },
  };

  readonly sessions: ScopedAgentRuntime['sessions'] = {
    list: () => {
      this.deps.ensureReady();
      return this.deps.storage.listSessions(this.deps.context.tenantId);
    },
    create: () => {
      this.deps.ensureReady();
      const now = new Date();
      const session = {
        sessionId: generateId(), tenantId: this.deps.context.tenantId, contexts: { bindings: [] },
        version: 0, createdAt: new Date(now), updatedAt: new Date(now),
      };
      return this.deps.storage.transaction((uow) => {
        uow.sessions.insert(session);
        return structuredClone(session);
      });
    },
    get: (sessionId: string) => {
      this.deps.ensureReady();
      return getScopedSession(this.deps.storage, this.deps.context.tenantId, sessionId);
    },
    listEntries: async (sessionId: string) => {
      this.deps.ensureReady();
      await getScopedSession(this.deps.storage, this.deps.context.tenantId, sessionId);
      return this.deps.storage.listSessionEntries(sessionId);
    },
    patchContexts: (sessionId, patch, expectedVersion) => {
      this.deps.ensureReady();
      return patchSessionContexts(this.deps.storage, this.deps.context, sessionId, patch, expectedVersion);
    },
  };

  readonly runs: ScopedAgentRuntime['runs'] = {
    start: async (input: StartRunInput): Promise<AgentRun> => {
      this.deps.ensureReady();
      const run = await this.deps.startRun.execute(this.deps.context, input);
      // 幂等重放返回已有 Run 时也会再发一次 run.created；Signal 只是可丢失的 hint，
      // 订阅方以持久化状态为准，重复提示不影响正确性。
      this.deps.signals.publish({ runId: run.runId, type: 'run.created', occurredAt: run.createdAt });
      this.deps.observe?.({
        type: 'run.created', occurredAt: run.createdAt, tenantId: run.tenantId, sessionId: run.sessionId,
        runId: run.runId, agentId: run.agentId,
      });
      return run;
    },
    get: (runId: string) => {
      this.deps.ensureReady();
      return getScopedRun(this.deps.storage, this.deps.context.tenantId, runId);
    },
    cancel: async (runId: string): Promise<AgentRun> => {
      this.deps.ensureReady();
      await getScopedRun(this.deps.storage, this.deps.context.tenantId, runId);
      await this.deps.worker.cancel(runId);
      return getScopedRun(this.deps.storage, this.deps.context.tenantId, runId);
    },
    listEvents: (runId: string, afterSequence?: number, limit?: number) => {
      this.deps.ensureReady();
      return listScopedRunEvents(this.deps.storage, this.deps.context.tenantId, runId, afterSequence, limit);
    },
    subscribe: (runId: string, signal?: AbortSignal) => {
      this.deps.ensureReady();
      return createRunSignalStream(this.deps, runId, signal);
    },
    waitForCompletion: (runId: string, signal?: AbortSignal) => {
      this.deps.ensureReady();
      return waitForRunCompletion(this.deps, runId, signal);
    },
    list: async (options) => {
      this.deps.ensureReady();
      let items: AgentRun[];
      const requestedLimit = options?.limit ?? 100;
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
        throw new RuntimeError('INVALID_INPUT', 'limit must be an integer between 1 and 1000');
      }
      const fetchLimit = requestedLimit < 1000 ? requestedLimit + 1 : requestedLimit;
      try { items = await this.deps.storage.listRuns(this.deps.context.tenantId, { ...options, limit: fetchLimit }); }
      catch (error) {
        if (error instanceof InvalidRunCursorError) throw new RuntimeError('INVALID_INPUT', 'Invalid run cursor', false, undefined, { cause: error });
        throw error;
      }
      const hasMore = items.length > requestedLimit || (requestedLimit === 1000 && items.length === requestedLimit);
      const page = hasMore ? items.slice(0, requestedLimit) : items;
      const last = page.at(-1);
      return {
        items: page,
        ...(hasMore && last ? { nextCursor: encodeRunCursor({ createdAt: last.createdAt.toISOString(), runId: last.runId }) } : {}),
      };
    },
    listExecutionNodes: (runId) => { this.deps.ensureReady(); return listScopedExecutionNodes(this.deps.storage, this.deps.context.tenantId, runId); },
    listExecutionEntries: (runId, options) => { this.deps.ensureReady(); return listScopedExecutionEntries(this.deps.storage, this.deps.context.tenantId, runId, options); },
    listDeliveries: (runId) => { this.deps.ensureReady(); return listScopedDeliveries(this.deps.storage, this.deps.context.tenantId, runId); },
    listToolInvocations: async (runId) => {
      this.deps.ensureReady();
      await getScopedRun(this.deps.storage, this.deps.context.tenantId, runId);
      return this.deps.storage.transaction((uow) => uow.toolInvocations.listByRun(runId));
    },
    resolveToolInvocation: async (_runId, _invocationId, _resolution) => {
      const run = await new ResolveToolInvocationUsecase({
        storage: this.deps.storage, onEventCommitted: (event) => this.deps.signals.publishEvent(event),
      }).execute(this.deps.context, _runId, _invocationId, _resolution);
      if (run.status === 'queued') this.deps.observe?.({ type: 'run.requeued', occurredAt: run.updatedAt, tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId, agentId: run.agentId });
      else if (run.status === 'waiting') this.deps.observe?.({ type: 'run.waiting', occurredAt: run.updatedAt, tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId, agentId: run.agentId, waitingReason: run.waitingReason });
      else if (run.status === 'failed') this.deps.observe?.({ type: 'run.failed', occurredAt: run.updatedAt, tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId, agentId: run.agentId, ...(safeErrorCode(run.errorCode) === undefined ? {} : { errorCode: safeErrorCode(run.errorCode) }) });
      return run;
    },
  };

  readonly artifacts: ScopedAgentRuntime['artifacts'] = {
    listByRun: (runId: string) => {
      this.deps.ensureReady();
      return listScopedRunArtifacts(this.deps.storage, this.deps.context.tenantId, runId);
    },
    get: (artifactId: string) => {
      this.deps.ensureReady();
      return getScopedArtifact(this.deps.storage, this.deps.context.tenantId, artifactId);
    },
  };
}

function safeErrorCode(value: string | undefined): RuntimeErrorCode | undefined {
  return RUNTIME_ERROR_CODES.includes(value as RuntimeErrorCode) ? value as RuntimeErrorCode : undefined;
}
