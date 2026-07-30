import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentDI, WorkspaceRecord } from 'rem-agent-core';
import { WorkspaceService } from '../src/workspace-service.js';

function createFakeDI() {
  const records: WorkspaceRecord[] = [];
  const di = {
    configProvider: { forWorkspace: undefined },
    storage: {
      workspaceStore: {
        list: async () => records,
        add: async (path: string) => { const r = { path, createdAt: Date.now() } as WorkspaceRecord; records.push(r); return r; },
        remove: async (path: string) => { const i = records.findIndex((r) => r.path === path); if (i >= 0) records.splice(i, 1); },
      },
    },
  } as unknown as AgentDI;
  return { di, records };
}

describe('WorkspaceService', () => {
  it('add/list/remove（add 校验目录存在）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ws-test-'));
    const { di } = createFakeDI();
    const svc = new WorkspaceService(di);
    await svc.add(dir);
    expect(await svc.list()).toHaveLength(1);
    await svc.remove(dir);
    expect(await svc.list()).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  it('add 不存在目录抛错', async () => {
    const { di } = createFakeDI();
    const svc = new WorkspaceService(di);
    await expect(svc.add('/no/such/dir/xyz')).rejects.toThrow('Workspace path');
  });

  it('resolveConfig 无 forWorkspace 时返回原 configProvider', () => {
    const { di } = createFakeDI();
    const svc = new WorkspaceService(di);
    expect(svc.resolveConfig('any')).toBe(di.configProvider);
  });
});
