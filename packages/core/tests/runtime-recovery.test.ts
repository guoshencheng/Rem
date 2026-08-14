import type { AgentRun, RunStatus, WorkItem } from '../src/domain/run/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../src/sdk/runtime-storage.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../src/assembly/agent-runtime-assembly.js';
import type { AgentRuntime } from '../src/application/runtime/types.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { SqliteRuntimeStorageProvider } from '../src/plugins/storage/sqlite/runtime-provider.js';
import { createFakeAssembly } from './helpers/fake-di.js';

const base = new Date('2026-08-12T00:00:00.000Z');
const expired = new Date(base.getTime() - 60_000);
const context = { tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: ['member'] } };
const definition = {
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [] as string[], acceptedTriggers: ['task' as const], execution: { type: 'single-agent' as const },
};
const contextSnapshot = { items: [], configLayers: [], promptSections: [] };

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('AgentRuntime 重启恢复', () => {
  it('崩溃残留状态在第二个 Runtime initialize 时收敛：可重试的重排完成，不确定的转 waiting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-runtime-recovery-')); paths.push(dir);
    const dbPath = join(dir, 'runtime.db');
    const assembly = await createFakeAssembly();
    const definitions = new StaticAgentDefinitionProvider([definition]);

    // 第一个 Runtime 正常运行过，随后在不同执行位置“崩溃”（直接落库残留状态）
    const providerA = new SqliteRuntimeStorageProvider({ dbPath });
    const first = createAgentRuntime({ agentDefinitions: definitions, storage: providerA, models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, worker: { pollMs: 10 } });
    await first.initialize();
    await first.shutdown();
    await seedCrashState(providerA.runtimeStore);
    await providerA.close();

    // 第二个 Runtime 打开同一数据库文件，initialize 必须先恢复再启动 Worker
    const providerB = new SqliteRuntimeStorageProvider({ dbPath });
    const second = createAgentRuntime({ agentDefinitions: definitions, storage: providerB, models: assembly.models, config: assembly.runtimeConfigProvider, executionRoot: assembly.executionRoot, worker: { pollMs: 10 } });
    await second.initialize();

    // non-idempotent executing ToolInvocation：标记 unknown，Run 转 waiting，不再被调度
    const unknown = await providerB.runtimeStore.getRun('run-unknown');
    expect(unknown).toMatchObject({ status: 'waiting', waitingReason: 'recovery' });
    await providerB.runtimeStore.transaction((uow) => {
      expect(uow.toolInvocations.listByRun('run-unknown')).toHaveLength(1);
      expect(uow.toolInvocations.get('inv-unknown')).toMatchObject({ status: 'unknown', error: 'Tool result is unknown' });
      expect(uow.workItems.getByRun('run-unknown')).toMatchObject({ status: 'failed' });
      // idempotent executing ToolInvocation：标记回 planned 可重试
      expect(uow.toolInvocations.get('inv-idempotent')).toMatchObject({ status: 'planned' });
    });
    expect((await providerB.runtimeStore.listEvents('run-unknown')).map(({ sequence, type }) => [sequence, type])).toEqual([
      [1, 'run.created'], [2, 'run.started'], [3, 'tool.started'], [4, 'tool.result_unknown'], [5, 'run.waiting'],
    ]);

    // 其余四种残留恢复为 queued 并最终完成
    const scoped = second.as(context);
    for (const runId of ['run-queued', 'run-leased', 'run-running', 'run-idempotent']) {
      await expect(scoped.runs.waitForCompletion(runId)).resolves.toMatchObject({ status: 'completed' });
    }
    expect((await providerB.runtimeStore.listEvents('run-running')).map(({ type }) => type)).toEqual([
      'run.created', 'run.started', 'run.requeued', 'run.started', 'artifact.created', 'run.completed',
    ]);
    expect((await providerB.runtimeStore.listEvents('run-idempotent')).map(({ type }) => type)).toContain('run.requeued');

    // waiting 的 Run 不会被再次执行：事件不再增长，状态保持 waiting
    expect(await providerB.runtimeStore.getRun('run-unknown')).toMatchObject({ status: 'waiting', waitingReason: 'recovery' });
    expect((await providerB.runtimeStore.listEvents('run-unknown')).map(({ type }) => type)).toEqual([
      'run.created', 'run.started', 'tool.started', 'tool.result_unknown', 'run.waiting',
    ]);
    await providerB.runtimeStore.transaction((uow) => {
      expect(uow.toolInvocations.get('inv-unknown')).toMatchObject({ status: 'unknown' });
    });

    await second.shutdown();
    await providerB.close();
  }, 15000);
});

async function seedCrashState(store: RuntimeStorage): Promise<void> {
  await store.transaction((uow) => {
    uow.sessions.insert({ sessionId: 'session-1', tenantId: 'tenant-1', contexts: { bindings: [] }, createdAt: base, updatedAt: base });
    seedRun(uow, 'run-queued', 'queued', 'queued');
    seedRun(uow, 'run-leased', 'queued', 'leased');
    seedRun(uow, 'run-running', 'running', 'leased');
    seedRun(uow, 'run-idempotent', 'running', 'leased', { sideEffect: 'idempotent' });
    seedRun(uow, 'run-unknown', 'running', 'leased', { sideEffect: 'non-idempotent' });
  });
}

function seedRun(
  uow: RuntimeUnitOfWork,
  runId: string,
  status: RunStatus,
  workStatus: WorkItem['status'],
  invocation?: { sideEffect: 'idempotent' | 'non-idempotent' },
): void {
  const running = status === 'running';
  const run: AgentRun = {
    runId, tenantId: 'tenant-1', principalId: 'user-1', sessionId: 'session-1',
    agentId: 'assistant', agentRevision: '1', status, trigger: { type: 'task', input: null },
    contextSnapshot, createdAt: base, updatedAt: base,
    ...(running ? { startedAt: base } : {}),
  };
  uow.runs.insert(run);
  uow.events.append({
    eventId: `created-${runId}`, sequence: 1, schemaVersion: 1, tenantId: 'tenant-1',
    sessionId: 'session-1', runId, type: 'run.created', data: {}, occurredAt: base,
  });
  let sequence = 1;
  if (running) {
    uow.events.append({
      eventId: `started-${runId}`, sequence: ++sequence, schemaVersion: 1, tenantId: 'tenant-1',
      sessionId: 'session-1', runId, type: 'run.started', data: { attempt: 1 }, occurredAt: base,
    });
  }
  uow.workItems.insert({
    workItemId: `work-${runId}`, runId, status: workStatus, attempt: workStatus === 'leased' ? 1 : 0,
    ...(workStatus === 'leased' ? { leaseOwner: 'dead-worker', leaseExpiresAt: expired } : {}),
    createdAt: base, updatedAt: base,
  });
  if (invocation) {
    const invocationId = runId === 'run-unknown' ? 'inv-unknown' : 'inv-idempotent';
    uow.toolInvocations.insert({
      invocationId, tenantId: 'tenant-1', sessionId: 'session-1', runId, toolCallId: `call-${runId}`,
      toolName: 'acme_charge', status: 'executing', sideEffect: invocation.sideEffect,
      supportsIdempotencyKey: false, input: { amount: 1 }, createdAt: base, updatedAt: base,
    });
    uow.events.append({
      eventId: `tool-started-${runId}`, sequence: ++sequence, schemaVersion: 1, tenantId: 'tenant-1',
      sessionId: 'session-1', runId, type: 'tool.started',
      data: { invocationId, toolCallId: `call-${runId}`, toolName: 'acme_charge' }, occurredAt: base,
    });
  }
}
