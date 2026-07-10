import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentService } from '../../src/agent.js';
import { JsonWorkspaceRepository } from '../../src/workspace-repository-json.js';
import { SqliteStorageProvider } from 'rem-agent-core';

const DEFAULT_WORKSPACE = 'default';

describe('AgentService.listSessions preserves details through JSON', () => {
  it('returns tokenUsage with inputTokenDetails', async () => {
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
      msg1: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        inputTokenDetails: { noCacheTokens: 70, cacheReadTokens: 30 },
      },
    };
    await ctx.sessionProvider.save(session);

    const list = await service.listSessions(DEFAULT_WORKSPACE);
    console.log('listSessions tokenUsage:', JSON.stringify(list[0].tokenUsage, null, 2));

    expect(list[0].tokenUsage?.inputTokenDetails).toEqual({
      noCacheTokens: 70,
      cacheReadTokens: 30,
      cacheWriteTokens: 0,
    });

    // Simulate JSON serialization as in HTTP response
    const serialized = JSON.parse(JSON.stringify(list));
    console.log('serialized tokenUsage:', JSON.stringify(serialized[0].tokenUsage, null, 2));
    expect(serialized[0].tokenUsage.inputTokenDetails).toEqual({
      noCacheTokens: 70,
      cacheReadTokens: 30,
      cacheWriteTokens: 0,
    });

    await storageProvider.close();
    await rm(dir, { recursive: true, force: true });
  });
});
