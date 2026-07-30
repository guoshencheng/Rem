import { describe, it, expect, vi } from 'vitest';
import { SkillsSection } from '../../../src/system-prompt/sections/skills-section.js';
import type { PromptBuildContext } from '../../../src/sdk/system-prompt.js';
import type { SkillProvider } from '../../../src/sdk/skill-provider.js';

const baseCtx: PromptBuildContext = {
  agentName: 'Rem',
  workspaceRoot: '/tmp',
  readOnly: false,
  tools: [],
  skills: [],
  model: { provider: 'openai', model: 'gpt-4o' },
  runtime: { platform: 'darwin', nodeVersion: 'v20.0.0', today: '2026-07-09', cwd: '/tmp' },
};

describe('SkillsSection', () => {
  it('returns undefined when catalog is empty', () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => '',
      readSkillRaw: vi.fn(),
    };
    const section = new SkillsSection(skillProvider);
    expect(section.render(baseCtx)).toBeUndefined();
  });

  it('delegates to skillProvider.formatCatalog', () => {
    const skillProvider: SkillProvider = {
      loadSkills: vi.fn(),
      formatCatalog: () => 'SKILL_CATALOG_CONTENT',
      readSkillRaw: vi.fn(),
    };
    const section = new SkillsSection(skillProvider);
    const result = section.render({ ...baseCtx, skills: [{ name: 'test', description: 'd', location: 'l', content: 'c' }] });
    expect(result).toBe('SKILL_CATALOG_CONTENT');
  });
});
