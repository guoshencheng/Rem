import type { AgentDefinition } from '../../domain/agent-definition/types.js';
import type { Artifact } from '../../domain/artifact/types.js';
import type { RunEvent, RunSignal } from '../../domain/event/types.js';
import type { RuntimeRequestContext } from '../../domain/identity/types.js';
import type { AgentRun } from '../../domain/run/types.js';
import type { AgentSession } from '../../domain/session/types.js';
import type { LocalRunWorker } from '../../execution/local-worker.js';
import type { RunSignalHub } from '../../runtime-events/run-signal-hub.js';
import type { AgentDefinitionProvider } from '../../sdk/agent-definition-provider.js';
import type { RuntimeStorage } from '../../sdk/runtime-storage.js';
import type { StartRunUsecase } from '../runs/start-run.js';
import type { StartRunInput } from '../runs/types.js';

export type { StartRunInput } from '../runs/types.js';

export interface AgentRuntime {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  as(context: RuntimeRequestContext): ScopedAgentRuntime;
}

export interface ScopedAgentRuntime {
  agents: {
    list(): Promise<AgentDefinition[]>;
    get(agentId: string, revision?: string): Promise<AgentDefinition>;
  };
  sessions: {
    get(sessionId: string): Promise<AgentSession>;
  };
  runs: {
    start(input: StartRunInput): Promise<AgentRun>;
    get(runId: string): Promise<AgentRun>;
    cancel(runId: string): Promise<AgentRun>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<RunEvent[]>;
    subscribe(runId: string, signal?: AbortSignal): AsyncIterable<RunSignal>;
    waitForCompletion(runId: string, signal?: AbortSignal): Promise<AgentRun>;
  };
  artifacts: {
    listByRun(runId: string): Promise<Artifact[]>;
  };
}

/** 装配入口（assembly）注入的构造依赖；Worker 的 onEventCommitted 须接到 signals。 */
export interface AgentRuntimeDeps {
  storage: RuntimeStorage;
  agentDefinitions: AgentDefinitionProvider;
  startRun: StartRunUsecase;
  worker: LocalRunWorker;
  signals: RunSignalHub;
  /** waitForCompletion 的兜底轮询间隔。 */
  waitPollMs?: number;
}

export interface ScopedRuntimeDeps {
  context: RuntimeRequestContext;
  ensureReady(): void;
  storage: RuntimeStorage;
  agentDefinitions: AgentDefinitionProvider;
  startRun: StartRunUsecase;
  worker: LocalRunWorker;
  signals: RunSignalHub;
  waitPollMs: number;
}
