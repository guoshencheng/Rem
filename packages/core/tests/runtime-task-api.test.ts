import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { AgentRun, ToolInvocation } from '../src/domain/run/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { ScopedAgentRuntimeImpl } from '../src/application/runtime/scoped-agent-runtime.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { RunSignalHub } from '../src/runtime-events/run-signal-hub.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const request: RuntimeRequestContext = {
  tenantId: 'tenant-1', principal: { principalId: 'principal-1', roles: ['member'] },
};
const definition: AgentDefinition = {
  agentId: 'task-agent', revision: '1', name: 'Task Agent', instructions: 'Complete tasks',
  modelId: 'mock/model', toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
};

async function createRuntime() {
  const { store } = await createFakeRuntimeStore();
  const definitions = new StaticAgentDefinitionProvider([definition]);
  const startRun = new StartRunUsecase({
    storage: store, agentDefinitions: definitions, contextResolver: new ContextResolver(new RuntimePluginHost()),
    generateId: (() => { let value = 0; return () => `id-${++value}`; })(),
  });
  const worker = { cancel: async () => {} } as never;
  const scoped = new ScopedAgentRuntimeImpl({
    context: request, ensureReady: () => {}, storage: store, agentDefinitions: definitions,
    startRun, worker, signals: new RunSignalHub(), waitPollMs: 5,
  });
  return { store, scoped };
}

async function setRunStatus(store: Awaited<ReturnType<typeof createFakeRuntimeStore>>['store'], run: AgentRun, status: AgentRun['status']) {
  await store.transaction((uow) => uow.runs.update({
    ...run, status, updatedAt: new Date('2026-08-14T00:00:01.000Z'),
    ...(status === 'completed' ? { finishedAt: new Date('2026-08-14T00:00:01.000Z') } : {}),
  }));
}

describe('Runtime Task API', () => {
  it('将 task input 映射到现有 Run 生命周期，并支持幂等 start', async () => {
    const { scoped } = await createRuntime();
    const input = { agentId: 'task-agent', input: { ticketId: 'T-1' }, idempotencyKey: 'task-1' };
    const first = await scoped.tasks.start(input);
    const replay = await scoped.tasks.start(input);
    expect(first.runId).toBe(replay.runId);
    expect(first.trigger).toEqual({ type: 'task', input: { ticketId: 'T-1' } });
  });

  it('completed 时读取 primary Artifact 并解析 JSON value', async () => {
    const { store, scoped } = await createRuntime();
    const run = await scoped.tasks.start({ agentId: 'task-agent', input: { ticketId: 'T-2' } });
    const artifact = {
      artifactId: 'artifact-1', tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId,
      type: 'result', mediaType: 'application/json', name: 'result.json', data: '{"ok":true}',
      createdAt: new Date('2026-08-14T00:00:01.000Z'),
    };
    await store.transaction((uow) => {
      uow.artifacts.insert(artifact);
      uow.runs.update({ ...run, status: 'completed', primaryArtifactId: artifact.artifactId, finishedAt: artifact.createdAt, updatedAt: artifact.createdAt });
    });
    const outcome = await scoped.tasks.wait(run.runId);
    expect(outcome).toMatchObject({ status: 'completed', run: { runId: run.runId }, result: { artifact: { artifactId: 'artifact-1' }, value: { ok: true } } });
  });

  it('waiting 返回全部 unknown invocation，业务状态不作为异常抛出', async () => {
    const { store, scoped } = await createRuntime();
    const run = await scoped.tasks.start({ agentId: 'task-agent', input: { ticketId: 'T-3' } });
    const invocation: ToolInvocation = {
      invocationId: 'invocation-1', tenantId: run.tenantId, sessionId: run.sessionId, runId: run.runId,
      nodeId: run.rootNodeId, toolCallId: 'call-1', toolName: 'send_ticket', status: 'unknown',
      sideEffect: 'non-idempotent', supportsIdempotencyKey: false, input: { ticketId: 'T-3' },
      error: 'Tool result is unknown', createdAt: run.createdAt, updatedAt: run.updatedAt,
    };
    await store.transaction((uow) => {
      uow.toolInvocations.insert(invocation);
      uow.runs.update({ ...run, status: 'waiting', waitingReason: 'tool-result-unknown', updatedAt: new Date() });
    });
    const outcome = await scoped.tasks.wait(run.runId);
    expect(outcome.status).toBe('waiting');
    if (outcome.status === 'waiting') expect(outcome.unknownInvocations).toHaveLength(1);
  });

  it.each(['failed', 'cancelled'] as const)('returns %s as a stable business outcome', async (status) => {
    const { store, scoped } = await createRuntime();
    const run = await scoped.tasks.start({ agentId: 'task-agent', input: { ticketId: status } });
    await setRunStatus(store, run, status);
    const outcome = await scoped.tasks.wait(run.runId);
    expect(outcome).toMatchObject({ status, run: { runId: run.runId } });
  });

  it('调用方 Abort 只终止等待，不请求取消 Run', async () => {
    const { store, scoped } = await createRuntime();
    const run = await scoped.tasks.start({ agentId: 'task-agent', input: { ticketId: 'T-4' } });
    const controller = new AbortController();
    const waiting = scoped.tasks.wait(run.runId, { signal: controller.signal });
    controller.abort(new Error('caller stopped waiting'));
    await expect(waiting).rejects.toMatchObject({ message: 'caller stopped waiting' });
    await expect(store.getRun(run.runId)).resolves.toMatchObject({ status: 'queued' });
  });
});
