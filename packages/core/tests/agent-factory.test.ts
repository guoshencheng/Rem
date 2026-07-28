import { describe, it, expect } from 'vitest';
import { createAgentFromEnv } from '../src/agent-factory.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDefaultAgentPaths } from '../src/config/paths.js';

describe('createAgentFromEnv', () => {
  it('returns raw providers and a toolComposer without pre-merging tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-agent-test-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ name: 'test-agent' }));

    const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir });

    const { di } = await createAgentFromEnv({ paths });

    expect(di.toolProvider).toBeDefined();
    expect(di.mcpProviders).toBeDefined();
    expect(di.mcpProviders).toBeInstanceOf(Array);
    expect(di.toolComposer).toBeDefined();
    expect(typeof di.toolComposer.compose).toBe('function');

    // read_skill should NOT be pre-registered on the raw toolProvider
    expect(di.toolProvider.getToolSet().some((t) => t.name === 'read_skill')).toBe(false);
  });
});
