import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { InMemoryToolProvider } from '../src/defaults/in-memory-tool-provider.js';

const echoSchema = Type.Object(
  { msg: Type.String() },
  { additionalProperties: false },
);

const addSchema = Type.Object(
  { a: Type.Number(), b: Type.Number() },
  { additionalProperties: false },
);

describe('InMemoryToolProvider', () => {
  it('should register and retrieve a tool', () => {
    const provider = new InMemoryToolProvider();
    provider.register(
      { name: 'echo', description: 'Echo input', parameters: echoSchema },
      async ({ msg }) => ({ output: msg }),
    );

    const toolSet = provider.getToolSet();
    expect(toolSet).toHaveProperty('echo');
    expect(toolSet.echo.description).toBe('Echo input');
  });

  it('should execute a registered tool', async () => {
    const provider = new InMemoryToolProvider();
    provider.register(
      { name: 'add', description: 'Add two numbers', parameters: addSchema },
      async ({ a, b }) => ({ output: String(a + b) }),
    );

    const results = await provider.execute(
      [{ toolCallId: 'tc1', toolName: 'add', input: { a: 1, b: 2 } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results).toHaveLength(1);
    expect(results[0].output).toBe('3');
    expect(results[0].toolCallId).toBe('tc1');
  });

  it('should return error for unregistered tool', async () => {
    const provider = new InMemoryToolProvider();
    const results = await provider.execute(
      [{ toolCallId: 'tc1', toolName: 'unknown', input: {} }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].error).toContain('not found');
  });

  it('should execute multiple tools serially', async () => {
    const provider = new InMemoryToolProvider();
    const order: number[] = [];

    provider.register(
      { name: 'first', description: '', parameters: Type.Object({}, { additionalProperties: false }) },
      async () => { order.push(1); return { output: '1' }; },
    );
    provider.register(
      { name: 'second', description: '', parameters: Type.Object({}, { additionalProperties: false }) },
      async () => { order.push(2); return { output: '2' }; },
    );

    await provider.execute(
      [
        { toolCallId: 'tc1', toolName: 'first', input: {} },
        { toolCallId: 'tc2', toolName: 'second', input: {} },
      ],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(order).toEqual([1, 2]);
  });
});
