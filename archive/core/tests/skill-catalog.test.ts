import { describe, it, expect } from 'vitest';
import { DefaultSkillCatalog } from '../src/plugins/skill/default-catalog.js';

describe('DefaultSkillCatalog', () => {
  it('returns empty string for no skills', () => {
    const catalog = new DefaultSkillCatalog();
    expect(catalog.format([])).toBe('');
  });

  it('includes guidance and available_skills block', () => {
    const catalog = new DefaultSkillCatalog();
    const output = catalog.format([
      {
        name: 'github',
        description: 'GitHub CLI for issues and PRs.',
        location: '/skills/github/SKILL.md',
        content: 'Use gh.',
      },
    ]);

    expect(output).toContain('call the `read_skill` tool');
    expect(output).toContain('<available_skills>');
    expect(output).toContain('<name>github</name>');
    expect(output).toContain('GitHub CLI for issues and PRs.');
    expect(output).toContain('</available_skills>');
  });
});
