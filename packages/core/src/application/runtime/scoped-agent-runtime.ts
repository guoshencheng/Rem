import type { AgentDefinition } from '../../domain/agent-definition/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import { getScopedRun, getScopedSession, listScopedRunArtifacts, listScopedRunEvents } from '../runs/run-queries.js';
import type { StartRunInput } from '../runs/types.js';
import { RuntimeError } from './runtime-error.js';
import { createRunSignalStream } from './run-signal-stream.js';
import { waitForRunCompletion } from './wait-for-completion.js';
import type { ScopedAgentRuntime, ScopedRuntimeDeps } from './types.js';

export class ScopedAgentRuntimeImpl implements ScopedAgentRuntime {
  constructor(private readonly deps: ScopedRuntimeDeps) {}

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
    get: (sessionId: string) => {
      this.deps.ensureReady();
      return getScopedSession(this.deps.storage, this.deps.context.tenantId, sessionId);
    },
  };

  readonly runs: ScopedAgentRuntime['runs'] = {
    start: async (input: StartRunInput): Promise<AgentRun> => {
      this.deps.ensureReady();
      const run = await this.deps.startRun.execute(this.deps.context, input);
      this.deps.signals.publish({ runId: run.runId, type: 'run.created', occurredAt: run.createdAt });
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
  };

  readonly artifacts: ScopedAgentRuntime['artifacts'] = {
    listByRun: (runId: string) => {
      this.deps.ensureReady();
      return listScopedRunArtifacts(this.deps.storage, this.deps.context.tenantId, runId);
    },
  };
}
