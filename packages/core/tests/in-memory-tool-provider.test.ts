import { describe, it, expect } from 'vitest';
import { InMemoryToolProvider } from '../src/defaults/in-memory-tool-provider.js';

describe('InMemoryToolProvider', () => {
  it('should register and retrieve a tool', () => {
    const provider = new InMemoryToolProvider();
    provider.register(
      { name: 'echo', description: 'Echo input', parameters: { type: 'object' } },
      async (input) => JSON.stringify(input),
    );

    const toolSet = provider.getToolSet();
    expect(toolSet).toHaveProperty('echo');
    expect(toolSet.echo.description).toBe('Echo input');
  });

  it('should execute a registered tool', async () => {
    const provider = new InMemoryToolProvider();
    provider.register(
      { name: 'add', description: 'Add two numbers', parameters: { type: 'object' } },
      async (input: any) => String(input.a + input.b),
    );

    const results = await provider.execute([
      { toolCallId: 'tc1', toolName: 'add', input: { a: 1, b: 2 } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].output).toBe('3');
    expect(results[0].toolCallId).toBe('tc1');
  });

  it('should return error for unregistered tool', async () => {
    const provider = new InMemoryToolProvider();
    const results = await provider.execute([
      { toolCallId: 'tc1', toolName: 'unknown', input: {} },
    ]);

    expect(results[0].error).toContain('not found');
  });

  it('should execute multiple tools serially', async () => {
    const provider = new InMemoryToolProvider();
    const order: number[] = [];

    provider.register(
      { name: 'first', description: '', parameters: {} },
      async () => { order.push(1); return '1'; },
    );
    provider.register(
      { name: 'second', description: '', parameters: {} },
      async () => { order.push(2); return '2'; },
    );

    await provider.execute([
      { toolCallId: 'tc1', toolName: 'first', input: {} },
      { toolCallId: 'tc2', toolName: 'second', input: {} },
    ]);

    expect(order).toEqual([1, 2]);
  });
});
