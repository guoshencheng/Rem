import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { RuntimeTaskOperations, StartTaskInput, TaskOutcome, ExecuteTaskOptions } from '../../domain/task/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import type { StartRunUsecase } from '../runs/start-run.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import type { RunSignalHub } from '../../runtime-events/run-signal-hub.js';
import { waitForTaskOutcome } from './wait-for-task-outcome.js';
import type { RuntimeObservationSink } from '../../sdk/runtime-observer.js';

interface TaskOperationDeps {
  context: RuntimeRequestContext;
  ensureReady: () => void;
  storage: RuntimeStorage;
  startRun: StartRunUsecase;
  signals: RunSignalHub;
  waitPollMs: number;
  observe?: RuntimeObservationSink;
}

export function createTaskOperations(deps: TaskOperationDeps): RuntimeTaskOperations {
  return {
    start: (input) => { deps.ensureReady(); return startTask(deps, input); },
    wait: (runId, options) => { deps.ensureReady(); return waitForTaskOutcome(deps, runId, options); },
    execute: async (input, options) => {
      deps.ensureReady();
      const run = await startTask(deps, input);
      return waitForTaskOutcome(deps, run.runId, options, run);
    },
  };
}

async function startTask(deps: TaskOperationDeps, input: StartTaskInput): Promise<AgentRun> {
  const run = await deps.startRun.execute(deps.context, {
    agentId: input.agentId,
    ...(input.agentRevision === undefined ? {} : { agentRevision: input.agentRevision }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.contexts === undefined ? {} : { contexts: input.contexts }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    trigger: { type: 'task', input: input.input },
  });
  deps.signals.publish({ runId: run.runId, type: 'run.created', occurredAt: run.createdAt });
  deps.observe?.({
    type: 'run.created', occurredAt: run.createdAt, tenantId: run.tenantId, sessionId: run.sessionId,
    runId: run.runId, agentId: run.agentId,
  });
  return run;
}
