import { describe, it, expect } from 'vitest';
import type { AgentStreamChunk, TurnResult } from '../src/types.js';
import type { McpServerConfig, McpConnectionState } from '../src/mcp/types.js';

describe('AgentStreamChunk types', () => {
  it('supports text part boundaries', () => {
    const start: AgentStreamChunk = { type: 'text-start', step: 1, partId: 'p1' };
    const delta: AgentStreamChunk = { type: 'text-delta', step: 1, partId: 'p1', text: 'hi' };
    const finish: AgentStreamChunk = { type: 'text-finish', step: 1, partId: 'p1' };
    expect(start.type).toBe('text-start');
    expect(delta.text).toBe('hi');
    expect(finish.partId).toBe('p1');
  });

  it('supports reasoning part boundaries', () => {
    const start: AgentStreamChunk = { type: 'reasoning-start', step: 1, partId: 'p2' };
    const delta: AgentStreamChunk = { type: 'reasoning-delta', step: 1, partId: 'p2', text: 'think' };
    const finish: AgentStreamChunk = { type: 'reasoning-finish', step: 1, partId: 'p2' };
    expect(start.type).toBe('reasoning-start');
    expect(delta.partId).toBe('p2');
    expect(finish.type).toBe('reasoning-finish');
  });

  it('supports tool part boundaries', () => {
    const start: AgentStreamChunk = { type: 'tool-call-start', step: 1, partId: 'tc1', toolCallId: 'tc1', toolName: 'search' };
    const payload: AgentStreamChunk = { type: 'tool-call', step: 1, partId: 'tc1', toolCallId: 'tc1', toolName: 'search', input: { q: 'x' } };
    const finish: AgentStreamChunk = { type: 'tool-call-finish', step: 1, partId: 'tc1', toolCallId: 'tc1', toolName: 'search' };
    expect(start.type).toBe('tool-call-start');
    expect(payload.input).toEqual({ q: 'x' });
    expect(finish.type).toBe('tool-call-finish');
  });

  it('TurnResult has content and usage', () => {
    const result: TurnResult = {
      content: 'hello',
      newMessages: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
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
