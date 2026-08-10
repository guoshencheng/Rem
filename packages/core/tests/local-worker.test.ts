import type { RunExecutor } from '../src/execution/run-executor.js';
import { describe, expect, it } from 'vitest';
import { LocalRunWorker } from '../src/execution/local-worker.js';
import { createFakeRuntimeStore } from './helpers/fake-runtime-store.js';

const instant = new Date('2026-08-10T02:00:00.000Z');

describe('LocalRunWorker', () => {
  it('领取 queued Run 并原子写入执行结果', async () => {
    const { store } = await createFakeRuntimeStore();
    await store.transaction((uow) => {
      uow.sessions.insert({
        sessionId: 'session-1', tenantId: 'tenant-1', contexts: { bindings: [] },
        createdAt: instant, updatedAt: instant,
      });
      uow.runs.insert({
        runId: 'run-1', tenantId: 'tenant-1', principalId: 'user-1',
        sessionId: 'session-1', agentId: 'agent-1', agentRevision: '1',
        status: 'queued', trigger: { type: 'task', input: null },
        contextSnapshot: { items: [], configLayers: [], promptSections: [] },
        createdAt: instant, updatedAt: instant,
      });
      uow.events.append({
        eventId: 'event-created', sequence: 1, schemaVersion: 1,
        tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1',
        type: 'run.created', data: {}, occurredAt: instant,
      });
      uow.workItems.insert({
        workItemId: 'work-1', runId: 'run-1', status: 'queued', attempt: 0,
        createdAt: instant, updatedAt: instant,
      });
    });
    const executor: RunExecutor = {
      execute: async () => ({
        sessionEntries: [{ message: { role: 'user', content: 'done', timestamp: instant.getTime() } }],
        artifacts: [{ type: 'result', mediaType: 'text/plain', name: 'answer', data: 'done' }],
      }),
    };
    let id = 0;
    const worker = new LocalRunWorker(store, executor, {
      owner: 'worker-1', leaseMs: 1_000, pollMs: 10, runTimeoutMs: 5_000,
      now: () => instant, generateId: () => `generated-${++id}`,
    });

    await expect(worker.drainOne()).resolves.toBe(true);
    expect(await store.getRun('run-1')).toMatchObject({ status: 'completed', finishedAt: instant });
    expect((await store.listEvents('run-1')).map((event) => event.type)).toEqual([
      'run.created', 'run.started', 'artifact.created', 'run.completed',
    ]);
    expect(await store.listArtifacts('run-1')).toMatchObject([{
      tenantId: 'tenant-1', sessionId: 'session-1', runId: 'run-1', data: 'done',
    }]);
  });
});
