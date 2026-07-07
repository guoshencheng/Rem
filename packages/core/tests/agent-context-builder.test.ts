import { describe, it, expect } from 'vitest';
import { buildAgentContext } from '../src/agent-context-builder.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('buildAgentContext', () => {
  it('returns raw providers and a toolComposer without pre-merging tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rem-agent-test-'));
    writeFileSync(join(dir, 'agent.json'), JSON.stringify({ name: 'test-agent' }));

    const previousHome = process.env.REM_AGENT_HOME;
    process.env.REM_AGENT_HOME = dir;

    try {
      const ctx = await buildAgentContext({ configPath: join(dir, 'agent.json') });

      expect(ctx.toolProvider).toBeDefined();
      expect(ctx.mcpProviders).toBeDefined();
      expect(ctx.mcpProviders).toBeInstanceOf(Array);
      expect(ctx.toolComposer).toBeDefined();
      expect(typeof ctx.toolComposer.compose).toBe('function');

      // read_skill should NOT be pre-registered on the raw toolProvider
      expect(ctx.toolProvider.getToolSet()).not.toHaveProperty('read_skill');
    } finally {
      if (previousHome === undefined) {
        delete process.env.REM_AGENT_HOME;
      } else {
        process.env.REM_AGENT_HOME = previousHome;
      }
    }
  });
});
