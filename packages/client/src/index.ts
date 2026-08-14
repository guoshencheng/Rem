import type {
  ExecuteTaskOptions, JsonValue, Run, RunLiveSignal, RunSignal, RuntimeHealth,
  StartRunInput, StartTaskInput, TaskOutcome, TaskResult,
} from 'rem-agent-core';
import { RuntimeHttpClient } from './http-client.js';
import type {
  ListEventsOptions, RuntimeClientAgents, RuntimeClientArtifacts, RuntimeClientOptions,
  RuntimeClientRuns, RuntimeClientSessions, RuntimeClientHealth, SubscribeOptions, WaitForCompletionOptions,
} from './types.js';
import { decodeRun } from './wire-values.js';
import { subscribeToRun, waitForRemoteRun } from './sse-client.js';
import { createRuntimeClientTasks, type RuntimeClientTasks } from './task-client.js';

export { RuntimeClientError } from './client-error.js';
export type * from './types.js';
export type { RuntimeClientTasks } from './task-client.js';

export class RuntimeClient {
  private readonly http: RuntimeHttpClient;
  readonly agents: RuntimeClientAgents;
  readonly sessions: RuntimeClientSessions;
  readonly runs: RuntimeClientRuns;
  readonly tasks: RuntimeClientTasks;
  readonly artifacts: RuntimeClientArtifacts;
  readonly health: RuntimeClientHealth;

  constructor(options: RuntimeClientOptions) {
    this.http = new RuntimeHttpClient(options);
    this.agents = { list: () => this.http.listAgents(), get: (id, revision) => this.http.getAgent(id, revision) };
    this.sessions = {
      list: () => this.http.listSessions(),
      create: () => this.http.createSession(),
      get: (id) => this.http.getSession(id),
      listEntries: (id) => this.http.listSessionEntries(id),
      patchContexts: (id, patch, expectedVersion) => this.http.patchSessionContexts(id, patch, expectedVersion),
    };
    this.runs = {
      list: (options) => this.http.listRuns(options),
      start: (input) => this.http.startRun(input),
      get: (id) => this.http.getRun(id),
      cancel: (id) => this.http.cancelRun(id),
      listEvents: (id, options) => this.http.listEvents(id, options),
      subscribe: (id, options) => subscribeToRun(this.http, id, options),
      waitForCompletion: (id, options) => waitForRemoteRun(this.http, id, options),
      listExecutionNodes: (id) => this.http.listExecutionNodes(id),
      listExecutionEntries: (id, options) => this.http.listExecutionEntries(id, options),
      listDeliveries: (id) => this.http.listDeliveries(id),
      listToolInvocations: (id) => this.http.listToolInvocations(id),
      resolveToolInvocation: (id, invocationId, resolution) => this.http.resolveToolInvocation(id, invocationId, resolution),
    };
    this.tasks = createRuntimeClientTasks(this.http);
    this.health = { get: () => this.http.getHealth() };
    this.artifacts = { listByRun: (id) => this.http.listArtifacts(id), get: (id) => this.http.getArtifact(id) };
  }
}

export type {
  ExecuteTaskOptions, JsonValue, Run, RunLiveSignal, RunSignal, RuntimeHealth,
  StartRunInput, StartTaskInput, TaskOutcome, TaskResult,
};
