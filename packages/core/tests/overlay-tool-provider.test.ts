import { describe, it, expect } from 'vitest';
import { Type, type Static } from '@sinclair/typebox';
import { OverlayToolProvider } from '../src/overlay-tool-provider.js';
import type { ToolProvider, ToolDefinition, ToolExecutor } from '../src/sdk/tool-provider.js';

function createBaseProvider(tools: Record<string, { def: ToolDefinition; executor: ToolExecutor }>): ToolProvider {
  return {
    register: () => {},
    getToolSet: () => {
      const result: Record<string, { description: string; parameters: Record<string, unknown> }> = {};
      for (const [name, { def }] of Object.entries(tools)) {
        result[name] = { description: def.description, parameters: def.parameters as Record<string, unknown> };
      }
      return result;
    },
    execute: async (calls) => {
      const results = [];
      for (const call of calls) {
        const tool = tools[call.toolName];
        if (!tool) {
          results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output: '', error: 'not found' });
          continue;
        }
        const { output } = await tool.executor(call.input as never, { cwd: '/', workspaceRoot: '/' });
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output });
      }
      return results;
    },
    isDangerous: (name) => tools[name]?.def.dangerous === true,
  };
}

const echoSchema = Type.Object({ message: Type.String() });
type EchoInput = Static<typeof echoSchema>;

describe('OverlayToolProvider', () => {
  it('exposes base tools plus overlay tools', () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    const def: ToolDefinition<typeof echoSchema> = {
      name: 'echo',
      description: 'echo',
      parameters: echoSchema,
    };
    const executor: ToolExecutor<typeof echoSchema> = async ({ message }) => ({ output: message });
    overlay.register(def, executor);

    const tools = overlay.getToolSet();
    expect(tools).toHaveProperty('echo');
  });

  it('does not mutate the base provider when registering', () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    overlay.register(
      { name: 'echo', description: 'echo', parameters: echoSchema },
      async ({ message }) => ({ output: message }),
    );

    expect(base.getToolSet()).toEqual({});
    expect(overlay.getToolSet()).toHaveProperty('echo');
  });

  it('executes overlay tools independently of base provider', async () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    overlay.register(
      { name: 'echo', description: 'echo', parameters: echoSchema },
      async ({ message }) => ({ output: `overlay:${message}` }),
    );

    const results = await overlay.execute(
      [{ toolCallId: '1', toolName: 'echo', input: { message: 'hi' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('overlay:hi');
  });

  it('delegates unknown tools to base provider', async () => {
    const base = createBaseProvider({
      baseTool: {
        def: { name: 'baseTool', description: 'base', parameters: echoSchema },
        executor: async () => ({ output: 'from base' }),
      },
    });
    const overlay = new OverlayToolProvider(base);

    const results = await overlay.execute(
      [{ toolCallId: '1', toolName: 'baseTool', input: { message: 'x' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(results[0].output).toBe('from base');
  });

  it('reports isDangerous from overlay definition', () => {
    const base = createBaseProvider({});
    const overlay = new OverlayToolProvider(base);

    overlay.register(
      { name: 'dangerousTool', description: 'dangerous', parameters: echoSchema, dangerous: true },
      async () => ({ output: '' }),
    );

    expect(overlay.isDangerous('dangerousTool')).toBe(true);
    expect(overlay.isDangerous('missing')).toBe(false);
  });
});
