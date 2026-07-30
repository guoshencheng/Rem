import { describe, it, expect, vi } from 'vitest';
import { McpConnectionManager } from '../../src/mcp/connection-manager.js';

describe('McpConnectionManager', () => {
  it('skips disabled servers', async () => {
    const manager = new McpConnectionManager();
    const result = await manager.connectAll({
      disabled: { transport: 'stdio', command: 'echo', args: [], disabled: true },
    });
    expect(result).toHaveLength(0);
  });

  it('records error state for failing server without throwing', async () => {
    const manager = new McpConnectionManager();
    const result = await manager.connectAll({
      bad: { transport: 'stdio', command: 'this-command-does-not-exist-12345', args: [] },
    });
    expect(result).toHaveLength(0);
    const state = manager.getState('bad');
    expect(state?.status).toBe('error');
    expect(state?.error).toBeTruthy();
  });
});
