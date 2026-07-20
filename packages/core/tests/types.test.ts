import { describe, it, expect } from 'vitest';
import type { TurnResult } from '../src/types.js';
import type { McpServerConfig, McpConnectionState } from '../src/mcp/types.js';

describe('TurnResult', () => {
  it('has content and usage', () => {
    const result: TurnResult = {
      content: 'hello',
      newMessages: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    expect(result.content).toBe('hello');
  });
});

describe('MCP types', () => {
  it('accepts valid stdio config', () => {
    const cfg: McpServerConfig = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { KEY: 'value' },
    };
    expect(cfg.transport).toBe('stdio');
  });

  it('accepts valid sse config', () => {
    const cfg: McpServerConfig = {
      transport: 'sse',
      url: 'http://localhost:3001/sse',
      prefix: 'remote',
    };
    expect(cfg.transport).toBe('sse');
  });

  it('connection state can be error', () => {
    const state: McpConnectionState = { status: 'error', error: 'failed' };
    expect(state.status).toBe('error');
  });
});
