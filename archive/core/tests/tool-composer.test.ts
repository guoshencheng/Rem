import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import { composeToolProviders } from '../src/tool-composer.js';
import { InMemoryToolProvider } from './helpers/in-memory-tool-provider.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

function createFakeSkillProvider(rawByName: Record<string, string>): SkillProvider {
  return {
    loadSkills: async () => [],
    formatCatalog: () => '',
    readSkillRaw: async (name: string) => rawByName[name],
  };
}

describe('composeToolProviders', () => {
  it('registers read_skill when no mcp providers are given', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });

    const result = composeToolProviders({ toolProvider, mcpProviders: [], skillProvider });

    const tools = result.getToolSet();
    expect(tools.some((t) => t.name === 'read_skill')).toBe(true);
  });

  it('includes base tool provider tools in the result', () => {
    const toolProvider = new InMemoryToolProvider();
    toolProvider.register(
      { name: 'localTool', description: 'local', parameters: Type.Object({}) },
      async () => ({ output: 'ok' }),
    );

    const skillProvider = createFakeSkillProvider({});

    const result = composeToolProviders({ toolProvider, mcpProviders: [], skillProvider });

    const tools = result.getToolSet();
    expect(tools.some((t) => t.name === 'localTool')).toBe(true);
    expect(tools.some((t) => t.name === 'read_skill')).toBe(true);
  });

  it('does not mutate the original toolProvider when composing', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });

    composeToolProviders({ toolProvider, mcpProviders: [], skillProvider });

    expect(toolProvider.getToolSet().some((t) => t.name === 'read_skill')).toBe(false);
  });

  it('returns a new instance on each compose call', () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: 'bar' });

    const a = composeToolProviders({ toolProvider, mcpProviders: [], skillProvider });
    const b = composeToolProviders({ toolProvider, mcpProviders: [], skillProvider });

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

    const result = composeToolProviders({ toolProvider, mcpProviders: [mcpProvider], skillProvider });

    const tools = result.getToolSet();
    expect(tools.some((t) => t.name === 'mcp__tool')).toBe(true);
    expect(tools.some((t) => t.name === 'read_skill')).toBe(true);
  });

  it('read_skill executor can read skill raw content', async () => {
    const toolProvider = new InMemoryToolProvider();
    const skillProvider = createFakeSkillProvider({ foo: '---\nname: foo\n---\ncontent' });

    const result = composeToolProviders({ toolProvider, mcpProviders: [], skillProvider });
    const execResults = await result.execute(
      [{ toolCallId: '1', toolName: 'read_skill', input: { name: 'foo' } }],
      { cwd: '/', workspaceRoot: '/' },
    );

    expect(execResults[0].output).toBe('---\nname: foo\n---\ncontent');
  });
});
