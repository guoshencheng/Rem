import { describe, it, expect } from 'vitest';
import { createAgentFromEnv } from '../src/agent-factory.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDefaultAgentPaths } from '../src/config/paths.js';

describe('createAgentFromEnv', () => {
  it('returns raw providers and a toolComposer without pre-merging tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-agent-test-'));
    writeFileSync(join(dir, 'agent.json'), JSON.stringify({ name: 'test-agent' }));

    const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });

    const ctx = await createAgentFromEnv({ configPath: join(dir, 'agent.json'), paths });

    expect(ctx.toolProvider).toBeDefined();
    expect(ctx.mcpProviders).toBeDefined();
    expect(ctx.mcpProviders).toBeInstanceOf(Array);
    expect(ctx.toolComposer).toBeDefined();
    expect(typeof ctx.toolComposer.compose).toBe('function');

    // read_skill should NOT be pre-registered on the raw toolProvider
    expect(ctx.toolProvider.getToolSet()).not.toHaveProperty('read_skill');
  });
});
