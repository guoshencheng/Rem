import { describe, it, expect } from 'vitest';
import { createReadSkillToolDefinition, createReadSkillToolExecutor } from '../src/plugins/tool/builtin/skill-read.js';
import type { SkillProvider } from '../src/sdk/skill-provider.js';

function createFakeSkillProvider(rawByName: Record<string, string>): SkillProvider {
  return {
    loadSkills: async () => [],
    formatCatalog: () => '',
    readSkillRaw: async (name: string) => rawByName[name],
  };
}

describe('read_skill tool', () => {
  it('returns raw markdown when skill exists', async () => {
    const raw = '---\nname: foo\n---\n\nbar';
    const provider = createFakeSkillProvider({ foo: raw });
    const executor = createReadSkillToolExecutor(provider);

    const result = await executor({ name: 'foo' }, { cwd: '/', workspaceRoot: '/' });

    expect(result.output).toBe(raw);
  });

  it('throws when skill is not found', async () => {
    const provider = createFakeSkillProvider({});
    const executor = createReadSkillToolExecutor(provider);

    await expect(
      executor({ name: 'missing' }, { cwd: '/', workspaceRoot: '/' }),
    ).rejects.toThrow('not found');
  });

  it('exposes correct tool definition', () => {
    const def = createReadSkillToolDefinition();

    expect(def.name).toBe('read_skill');
    expect(def.description).toContain('SKILL.md');
    expect(def.parameters.properties).toHaveProperty('name');
    expect(def.parameters.required).toContain('name');
  });
});
