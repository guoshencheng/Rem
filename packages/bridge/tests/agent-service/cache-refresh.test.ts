import { describe, it, expect } from 'vitest';
import { AgentService } from '../../src/agent.js';
import { JsonWorkspaceRepository } from '../../src/workspace-repository-json.js';
import path from 'path';
import fs from 'fs/promises';

const DEFAULT_WORKSPACE = 'default';

describe('AgentService.listSessions preserves details through JSON', () => {
  it('returns tokenUsage with inputTokenDetails', async () => {
    const dir = '/tmp/rem-cache-test-service';
    await fs.rm(dir, { recursive: true, force: true });
    const repo = new JsonWorkspaceRepository(path.join(dir, 'workspaces.json'));
    const service = new AgentService({ workspaceRoot: dir, sessionsDir: path.join(dir, 'sessions') }, repo);
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

    // Print actual file content
    const files = await fs.readdir(path.join(dir, 'sessions'));
    console.log('session files:', files);
    for (const f of files) {
      if (f.endsWith('.meta.json')) {
        const content = await fs.readFile(path.join(dir, 'sessions', f), 'utf-8');
        console.log('meta.json:', content);
      }
    }

    const list = await service.listSessions(DEFAULT_WORKSPACE);
    console.log('listSessions tokenUsage:', JSON.stringify(list[0].tokenUsage, null, 2));

    expect(list[0].tokenUsage?.inputTokenDetails).toEqual({ noCacheTokens: 70, cacheReadTokens: 30, cacheWriteTokens: 0 });

    // Simulate JSON serialization as in HTTP response
    const serialized = JSON.parse(JSON.stringify(list));
    console.log('serialized tokenUsage:', JSON.stringify(serialized[0].tokenUsage, null, 2));
    expect(serialized[0].tokenUsage.inputTokenDetails).toEqual({ noCacheTokens: 70, cacheReadTokens: 30, cacheWriteTokens: 0 });
  });
});
