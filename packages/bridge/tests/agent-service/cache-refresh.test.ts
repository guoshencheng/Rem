import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../../src/agent.js';
import { JsonWorkspaceRepository } from '../../src/workspace-repository-json.js';
import { SqliteStorageProvider } from 'rem-agent-core';
import type { Usage } from 'rem-agent-core';

const DEFAULT_WORKSPACE = 'default';

const baseUsage = (overrides?: Partial<Usage>): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...overrides,
});

describe('AgentService.listSessions preserves usage through JSON', () => {
  it('returns tokenUsage with cacheRead', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rem-cache-test-'));
    const repo = new JsonWorkspaceRepository(join(dir, 'workspaces.json'));
    const storageProvider = new SqliteStorageProvider({ dbPath: join(dir, 'rem-agent.db') });
    const service = new AgentService(
      { workspaceRoot: dir, storageProvider },
      repo
    );
    await service.init();

    const ctx = service.context!;
    const session = await ctx.sessionProvider.create();
    (session.metadata as any).workspace = DEFAULT_WORKSPACE;
    (session.metadata as any).messageTokenUsage = {
      msg1: baseUsage({ input: 100, output: 20, cacheRead: 30, totalTokens: 120 }),
    };
    await ctx.sessionProvider.save(session);

    const list = await service.listSessions(DEFAULT_WORKSPACE);
    console.log('listSessions tokenUsage:', JSON.stringify(list[0].tokenUsage, null, 2));

    expect(list[0].tokenUsage?.totalTokens).toBe(120);
    expect(list[0].tokenUsage?.cacheRead).toBe(30);
    expect(list[0].tokenUsage?.cacheWrite).toBe(0);

    // Simulate JSON serialization as in HTTP response
    const serialized = JSON.parse(JSON.stringify(list));
    console.log('serialized tokenUsage:', JSON.stringify(serialized[0].tokenUsage, null, 2));
    expect(serialized[0].tokenUsage.totalTokens).toBe(120);
    expect(serialized[0].tokenUsage.cacheRead).toBe(30);

    await storageProvider.close();
    await rm(dir, { recursive: true, force: true });
  });
});
