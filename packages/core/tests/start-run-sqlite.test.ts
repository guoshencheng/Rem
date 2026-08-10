import type { AgentDefinition } from '../src/domain/agent-definition/types.js';
import type { RuntimeStorage, RuntimeUnitOfWork } from '../src/sdk/runtime-storage.js';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ContextResolver } from '../src/application/contexts/context-resolver.js';
import { StartRunUsecase } from '../src/application/runs/start-run.js';
import { RuntimePluginHost } from '../src/plugin-system/runtime-plugin-host.js';
import { StaticAgentDefinitionProvider } from '../src/plugins/agent-definition/static/provider.js';
import { SqliteRuntimeStore } from '../src/plugins/storage/sqlite/runtime-store.js';
import { SqliteSchemaManager } from '../src/plugins/storage/sqlite/schema.js';

const instant = new Date('2026-08-10T01:02:03.000Z');
const definition: AgentDefinition = {
  agentId: 'assistant', revision: '1', name: 'Assistant', instructions: 'Help', modelId: 'model',
  toolNames: [], acceptedTriggers: ['task'], execution: { type: 'single-agent' },
};
const request = {
  tenantId: 'tenant-1', principal: { principalId: 'user-1', roles: ['member'] },
};
const input = (value = 'same') => ({
  agentId: 'assistant', trigger: { type: 'task' as const, input: { value } }, idempotencyKey: 'key-1',
});

function openStore(): { db: Database.Database; store: SqliteRuntimeStore } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  new SqliteSchemaManager(db).migrate();
  return { db, store: new SqliteRuntimeStore(db) };
}

function start(storage: RuntimeStorage, ids: string[]): StartRunUsecase {
  let index = 0;
  return new StartRunUsecase({
    storage, agentDefinitions: new StaticAgentDefinitionProvider([definition]),
    contextResolver: new ContextResolver(new RuntimePluginHost()),
    now: () => instant, generateId: () => ids[index++]!,
  });
}

function failEventWrites(storage: RuntimeStorage): RuntimeStorage {
  return {
    ...storage,
    transaction: ((operation: (uow: RuntimeUnitOfWork) => unknown) => storage.transaction((uow) => operation({
      ...uow, events: { ...uow.events, append: () => { throw new Error('event failure'); } },
    }))) as RuntimeStorage['transaction'],
    getSession: (id) => storage.getSession(id), getRun: (id) => storage.getRun(id),
    listEvents: (id, after, limit) => storage.listEvents(id, after, limit),
    listArtifacts: (id) => storage.listArtifacts(id),
    claimWorkItem: (owner, now, lease) => storage.claimWorkItem(owner, now, lease),
    listRecoverableWorkItems: (now) => storage.listRecoverableWorkItems(now),
  };
}

describe('StartRun SQLite 组合边界', () => {
  it('创建后稳定回读，同 key 返回同一 run，不同请求冲突且不增加记录', async () => {
    const { db, store } = openStore();
    try {
      const usecase = start(store, ['session-1', 'run-1', 'event-1', 'work-1']);
      const created = await usecase.execute(request, input());
      const retried = await usecase.execute(request, input());

      expect(retried).toEqual(created);
      expect(await store.getSession('session-1')).toMatchObject({ sessionId: 'session-1', tenantId: 'tenant-1' });
      expect(await store.getRun('run-1')).toEqual(created);
      expect(await store.listEvents('run-1')).toHaveLength(1);
      await store.transaction((uow) => {
        expect(uow.workItems.getByRun('run-1')).toMatchObject({ workItemId: 'work-1' });
        expect(uow.idempotency.get('tenant-1', 'start-run', 'key-1')).toMatchObject({ resourceId: 'run-1' });
      });
      await expect(usecase.execute(request, input('changed'))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_runs').get()).toEqual({ count: 1 });
    } finally { db.close(); }
  });

  it('事务中事件写入失败时回滚全部 StartRun 记录', async () => {
    const { db, store } = openStore();
    try {
      const failing = failEventWrites(store);
      await expect(start(failing, ['session-1', 'run-1', 'event-1', 'work-1']).execute(request, input()))
        .rejects.toThrow('event failure');
      expect(await store.getSession('session-1')).toBeNull();
      expect(await store.getRun('run-1')).toBeNull();
      expect(await store.listEvents('run-1')).toEqual([]);
      await store.transaction((uow) => {
        expect(uow.workItems.getByRun('run-1')).toBeNull();
        expect(uow.idempotency.get('tenant-1', 'start-run', 'key-1')).toBeNull();
      });
    } finally { db.close(); }
  });
});
