import { describe, it, expect } from 'vitest';
import { AgentToolRegistry } from '../src/registry/tool-registry.js';
import { createExecToolDefinition, createExecToolExecutor } from '../src/plugins/tool/file-system/exec.js';
import type { ToolContext } from '../src/sdk/tool-provider.js';

function createRegistry() {
  const registry = new AgentToolRegistry({ workspaceRoot: process.cwd() });
  registry.register(createExecToolDefinition(), createExecToolExecutor());
  return registry;
}

const ctx: ToolContext = {
  cwd: process.cwd(),
  workspaceRoot: process.cwd(),
};

describe('exec tool', () => {
  it('executes a shell command', async () => {
    const registry = createRegistry();
    const results = await registry.execute(
      [{ toolCallId: '1', toolName: 'exec', input: { command: 'echo hello' } }],
      ctx,
    );
    expect(results[0].output).toContain('hello');
  });

  it('supports custom cwd', async () => {
    const registry = createRegistry();
    const results = await registry.execute(
      [{ toolCallId: '1', toolName: 'exec', input: { command: 'pwd', cwd: '/' } }],
      ctx,
    );
    expect(results[0].output).toContain('/');
  });

  it('respects timeout', async () => {
    const registry = createRegistry();
    const results = await registry.execute(
      [{ toolCallId: '1', toolName: 'exec', input: { command: 'sleep 5', timeoutSec: 0.1 } }],
      ctx,
    );
    expect(results[0].error).toBeDefined();
  });
});
