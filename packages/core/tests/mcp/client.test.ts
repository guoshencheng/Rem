import { describe, it, expect, vi } from 'vitest';
import { McpClient } from '../../src/mcp/client.js';

function createMockClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] }),
  };
}

function createMockTransport() {
  return { start: vi.fn(), send: vi.fn(), close: vi.fn(), onmessage: undefined, onerror: undefined, onclose: undefined };
}

describe('McpClient', () => {
  it('connects and lists tools', async () => {
    const mock = createMockClient();
    const client = new McpClient(mock as any, createMockTransport() as any, 'stdio-server');

    await client.connect();
    const tools = await client.listTools();

    expect(mock.connect).toHaveBeenCalled();
    expect(tools).toHaveLength(1);
    expect(tools[0].originalName).toBe('read_file');
  });

  it('calls a tool and returns text content', async () => {
    const mock = createMockClient();
    const client = new McpClient(mock as any, createMockTransport() as any, 'stdio-server');
    await client.connect();

    const result = await client.callTool('read_file', { path: '/tmp/foo' });

    expect(mock.callTool).toHaveBeenCalledWith({
      name: 'read_file',
      arguments: { path: '/tmp/foo' },
    });
    expect(result).toBe('hello');
  });

  it('returns JSON string for non-text content', async () => {
    const mock = createMockClient();
    mock.callTool.mockResolvedValue({ content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] });
    const client = new McpClient(mock as any, createMockTransport() as any, 'sse-server');

    const result = await client.callTool('capture', {});

    expect(result).toContain('image');
  });

  it('closes gracefully', async () => {
    const mock = createMockClient();
    const client = new McpClient(mock as any, createMockTransport() as any, 'server');
    await client.connect();
    await client.close();
    expect(mock.close).toHaveBeenCalled();
  });
});
