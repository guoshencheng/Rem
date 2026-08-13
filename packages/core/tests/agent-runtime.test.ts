import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RunSignal } from '../src/domain/event/types.js';
import type { RuntimeRequestContext } from '../src/domain/identity/types.js';
import type { LocalRunWorkerOptions } from '../src/execution/local-worker-options.js';
import type { RunExecutor } from '../src/execution/run-executor.js';
import { describe, expect, it, vi } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { AgentRuntimeImpl } from '../src/application/runtime/agent-runtime.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { RunSignalHub } from '../src/runtime-events/run-signal-hub.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';
import { ManualScheduler, seedRun, successResult } from './helpers/local-worker-fixture.js';

const instant = new Date('2026-08-10T03:00:00.000Z');
const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const context = (tenantId = 'tenant-1'): RuntimeRequestContext => ({
  tenantId, principal: { principalId: 'user-1', roles: ['member'] },
});
const definition = (changes: Partial<AgentDefinition> = {}): AgentDefinition => ({
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' }, ...changes,
});
const taskTrigger = { type: 'task' as const, input: null };
const successExecutor: RunExecutor = { execute: async () => structuredClone(successResult) };

async function createRuntime(
  executor: RunExecutor = successExecutor,
  workerChanges: Partial<LocalRunWorkerOptions> = {},
) {
  const { store } = await createFakeRuntimeStore();
  const agentDefinitions = new StaticAgentDefinitionProvider([definition()]);
  const signals = new RunSignalHub();
  let id = 0;
  const worker = new LocalRunWorker(store, executor, {
    owner: 'worker-1', leaseMs: 1_000, pollMs: 60_000, runTimeoutMs: 5_000,
    now: () => instant, generateId: () => `generated-${++id}`,
    scheduler: new ManualScheduler(),
    // workerChanges 传入 onEventCommitted: undefined 可断开 Signal 接线，模拟 Signal 全部丢失。
    onEventCommitted: (event) => signals.publishEvent(event),
    ...workerChanges,
  });
  const startRun = new StartRunUsecase({
    storage: store, agentDefinitions,
    contextResolver: new ContextResolver(new RuntimePluginHost([])),
    now: () => instant, generateId: () => `id-${++id}`,
  });
  const runtime = new AgentRuntimeImpl({
    storage: store, agentDefinitions, startRun, worker, signals, waitPollMs: 5,
  });
  return { store, runtime, worker };
}

async function collect(stream: AsyncIterable<RunSignal>): Promise<string[]> {
  const types: string[] = [];
  for await (const signal of stream) types.push(signal.type);
  return types;
}

describe('AgentRuntime', () => {
  it('initialize 前拒绝调用；initialize/shutdown 幂等且管理 Worker 生命周期', async () => {
    const { runtime, worker } = await createRuntime();
    const start = vi.spyOn(worker, 'start');
    const stop = vi.spyOn(worker, 'stop');
    expect(() => runtime.as(context())).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));

    await runtime.initialize();
    await runtime.initialize();
    expect(start).toHaveBeenCalledTimes(1);
    expect(() => runtime.as(context())).not.toThrow();

    await runtime.shutdown();
    await runtime.shutdown();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(() => runtime.as(context())).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await expect(runtime.initialize()).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('as() 拒绝空 tenant 或空 principal', async () => {
    const { runtime } = await createRuntime();
    await runtime.initialize();
    expect(() => runtime.as({ tenantId: '  ', principal: { principalId: 'user-1', roles: [] } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => runtime.as({ tenantId: 'tenant-1', principal: { principalId: '', roles: [] } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    await runtime.shutdown();
  });

  it('runs.start 返回 queued Run', async () => {
    const { store, runtime } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    expect(run).toMatchObject({
      tenantId: 'tenant-1', principalId: 'user-1', agentId: 'assistant',
      agentRevision: '1', status: 'queued', createdAt: instant,
    });
    expect(await store.getRun(run.runId)).toEqual(run);
    await runtime.shutdown();
  });

  it('runs.get / sessions.get 执行 tenant 隔离且不泄露存在性', async () => {
    const { runtime } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const other = runtime.as(context('tenant-2'));
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    expect(await scoped.runs.get(run.runId)).toMatchObject({ runId: run.runId });
    expect(await scoped.sessions.get(run.sessionId)).toMatchObject({ sessionId: run.sessionId });
    await expect(other.runs.get(run.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await expect(other.sessions.get(run.sessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(scoped.runs.get('missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await expect(scoped.sessions.get('missing')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await runtime.shutdown();
  });

  it('listEvents 使用 exclusive cursor', async () => {
    const { runtime } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const other = runtime.as(context('tenant-2'));
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    expect((await scoped.runs.listEvents(run.runId)).map((event) => event.type)).toEqual(['run.created']);
    await expect(scoped.runs.listEvents(run.runId, 1)).resolves.toEqual([]);
    await expect(other.runs.listEvents(run.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await runtime.shutdown();
  });

  it('subscribe 收到 run.started 与终态 Signal 后结束', async () => {
    const { runtime, worker } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    const reading = collect(scoped.runs.subscribe(run.runId));
    await tick();
    await worker.drainOne();
    expect(await reading).toEqual(['run.started', 'artifact.created', 'run.completed']);
    await runtime.shutdown();
  });

  it('subscribe 已终态 Run 立即结束；AbortSignal 结束迭代', async () => {
    const { runtime, worker } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });
    await worker.drainOne();

    await expect(collect(scoped.runs.subscribe(run.runId))).resolves.toEqual([]);

    const pending = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });
    const controller = new AbortController();
    const reading = collect(scoped.runs.subscribe(pending.runId, controller.signal));
    await tick();
    controller.abort();
    await expect(reading).resolves.toEqual([]);
    await runtime.shutdown();
  });

  it('waitForCompletion 依据 Signal 重读并返回终态 Run', async () => {
    const { runtime, worker } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    const waiting = scoped.runs.waitForCompletion(run.runId);
    await tick();
    await worker.drainOne();
    await expect(waiting).resolves.toMatchObject({ runId: run.runId, status: 'completed' });
    await expect(scoped.runs.waitForCompletion(run.runId)).resolves.toMatchObject({ status: 'completed' });
    await runtime.shutdown();
  });

  it('waitForCompletion 在 pending Signal 未兑现时 abort 也能 settle', async () => {
    const { runtime } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    const controller = new AbortController();
    const waiting = scoped.runs.waitForCompletion(run.runId, controller.signal);
    const settled = waiting.then(() => 'settled', () => 'settled');
    await tick(); // 让 wait 进入 parked next()（pending in flight）
    controller.abort();
    await expect(Promise.race([settled, tick(200).then(() => 'timeout')])).resolves.toBe('settled');
    await expect(waiting).rejects.toThrow();
    await runtime.shutdown();
  });

  it('waitForCompletion 在 Signal 全部丢失时通过轮询兜底检测到终态', async () => {
    const { runtime, worker } = await createRuntime(successExecutor, { onEventCommitted: undefined });
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    const waiting = scoped.runs.waitForCompletion(run.runId);
    await tick();
    await worker.drainOne(); // 终态已提交，但没有任何 Signal 送达
    await expect(waiting).resolves.toMatchObject({ runId: run.runId, status: 'completed' });
    await runtime.shutdown();
  });

  it('cancel queued Run 返回更新后的 Run 并执行 tenant 隔离', async () => {
    const { runtime } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const other = runtime.as(context('tenant-2'));
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    const cancelled = await scoped.runs.cancel(run.runId);
    expect(cancelled).toMatchObject({ status: 'cancelled', errorCode: 'EXECUTION_CANCELLED', finishedAt: instant });
    expect((await scoped.runs.listEvents(run.runId)).map((event) => event.type))
      .toEqual(['run.created', 'run.cancelled']);
    await expect(other.runs.cancel(run.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await expect(scoped.runs.cancel('missing')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await runtime.shutdown();
  });

  it('cancel running Run 请求取消并最终转为 cancelled', async () => {
    const hanging: RunExecutor = {
      execute: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('execution aborted')));
      }),
    };
    const { runtime, worker } = await createRuntime(hanging);
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });

    const draining = worker.drainOne();
    await tick();
    const requested = await scoped.runs.cancel(run.runId);
    expect(requested).toMatchObject({ status: 'running', cancellationRequestedAt: instant });
    await draining;
    expect(await scoped.runs.get(run.runId)).toMatchObject({ status: 'cancelled', errorCode: 'EXECUTION_CANCELLED' });
    await runtime.shutdown();
  });

  it('shutdown 后 Worker 停止、Storage 不再执行新任务且 scoped 调用被拒绝', async () => {
    const { store, runtime } = await createRuntime(successExecutor, { scheduler: undefined, pollMs: 10 });
    await runtime.initialize();
    const scoped = runtime.as(context());
    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });
    await expect(scoped.runs.waitForCompletion(run.runId)).resolves.toMatchObject({ status: 'completed' });

    await runtime.shutdown();
    await expect(scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await seedRun(store, { runId: 'leftover' });
    await tick(30);
    expect(await store.getRun('leftover')).toMatchObject({ status: 'queued' });
  });

  it('agents 与 artifacts 查询', async () => {
    const { runtime, worker } = await createRuntime();
    await runtime.initialize();
    const scoped = runtime.as(context());
    const other = runtime.as(context('tenant-2'));

    expect(await scoped.agents.list()).toHaveLength(1);
    expect(await scoped.agents.get('assistant')).toMatchObject({ agentId: 'assistant', revision: '1' });
    expect(await scoped.agents.get('assistant', '1')).toMatchObject({ revision: '1' });
    await expect(scoped.agents.get('missing')).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    await expect(scoped.agents.get('assistant', 'missing'))
      .rejects.toMatchObject({ code: 'AGENT_REVISION_NOT_FOUND' });

    const run = await scoped.runs.start({ agentId: 'assistant', trigger: taskTrigger });
    await worker.drainOne();
    expect(await scoped.artifacts.listByRun(run.runId)).toHaveLength(1);
    await expect(other.artifacts.listByRun(run.runId)).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
    await runtime.shutdown();
  });
});
