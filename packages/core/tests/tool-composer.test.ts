import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { DefaultToolComposer } from '../src/tool-composer.js';
import { InMemoryToolProvider } from '../src/plugins/tool/in-memory/index.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

function createFakeSkillProvider(rawByName: Record<string, string>): SkillProvider {
  return {
    loadSkills: async () => [],
    formatCatalog: () => '',
    readSkillRaw: async (name: string) => rawByName[name],
  };
}

describe('DefaultToolComposer', () => {
  it('registers read_skill when no mcp providers are given', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    const tools = result.getToolSet();
    expect(tools).toHaveProperty('read_skill');
  });

  it('includes base tool provider tools in the result', () => {
    const toolProvider = new InMemoryToolProvider();
    toolProvider.register(
      { name: 'localTool', description: 'local', parameters: Type.Object({}) },
      async () => ({ output: 'ok' }),
    );

    const skillProvider = createFakeSkillProvider({});
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    expect(result.getToolSet()).toHaveProperty('localTool');
    expect(result.getToolSet()).toHaveProperty('read_skill');
  });

  it('does not mutate the original toolProvider when composing', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });
    const composer = new DefaultToolComposer();

    composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    expect(toolProvider.getToolSet()).not.toHaveProperty('read_skill');
  });

  it('returns a new instance on each compose call', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });
    const composer = new DefaultToolComposer();

    const a = composer.compose({ toolProvider, mcpProviders: [], skillProvider });
    const b = composer.compose({ toolProvider, mcpProviders: [], skillProvider });

    expect(a).not.toBe(b);
  });

  it('uses CompositeToolProvider when mcp providers are present', () => {
    const toolProvider = new InMemoryToolProvider();
    const mcpProvider = new InMemoryToolProvider();
    mcpProvider.register(
      { name: 'mcp__tool', description: 'mcp tool', parameters: Type.Object({}) },
      async () => ({ output: 'mcp' }),
    );

    const skillProvider = createFakeSkillProvider({});
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [mcpProvider], skillProvider });

    expect(result.getToolSet()).toHaveProperty('mcp__tool');
    expect(result.getToolSet()).toHaveProperty('read_skill');
  });

  it('read_skill executor can read skill raw content', async () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: '---\nname: foo\n---\ncontent' });
    const composer = new DefaultToolComposer();

    const result = composer.compose({ toolProvider, mcpProviders: [], skillProvider });
    const execResults = await result.execute(
      [{ toolCallId: '1', toolName: 'read_skill', input: { name: 'foo' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(execResults[0].output).toBe('---\nname: foo\n---\ncontent');
  });
});
