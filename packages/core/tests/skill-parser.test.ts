import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown } from '../src/utils/skill-parser.js';

describe('parseSkillMarkdown', () => {
  it('parses a standard SKILL.md with name, description, and body', () => {
    const raw = `---
name: roll-dice
description: Roll dice using a random number generator.
---

To roll a die, use:\n\`\`\`bash\necho $((RANDOM % \u003csides\u003e + 1))\n\`\`\``;

    const { skill, diagnostics } = parseSkillMarkdown(raw, '/skills/roll-dice/SKILL.md');

    expect(diagnostics).toHaveLength(0);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('roll-dice');
    expect(skill!.description).toBe('Roll dice using a random number generator.');
    expect(skill!.location).toBe('/skills/roll-dice/SKILL.md');
    expect(skill!.content).toContain('echo $((RANDOM %');
  });

  it('returns null when description is missing', () => {
    const raw = `---
name: no-desc
---

Body content.`;

    const { skill, diagnostics } = parseSkillMarkdown(raw, '/skills/no-desc/SKILL.md');

    expect(skill).toBeNull();
    expect(diagnostics).toContain('SKILL.md is missing required "description" field');
  });

  it('returns null when name is missing', () => {
    const raw = `---
description: Some description.
---

Body content.`;

    const { skill, diagnostics } = parseSkillMarkdown(raw, '/skills/missing-name/SKILL.md');

    expect(skill).toBeNull();
    expect(diagnostics).toContain('SKILL.md is missing required "name" field');
  });

  it('returns null when frontmatter delimiters are missing', () => {
    const raw = `name: bad\ndescription: Bad skill.\n\nNo delimiters.`;

    const { skill, diagnostics } = parseSkillMarkdown(raw, '/skills/bad/SKILL.md');

    expect(skill).toBeNull();
    expect(diagnostics).toContain('SKILL.md must start with YAML frontmatter delimiters');
  });

  it('returns null when YAML is invalid', () => {
    const raw = `---
name: bad-yaml
  description: unclosed
---

Body.`;

    const { skill, diagnostics } = parseSkillMarkdown(raw, '/skills/bad-yaml/SKILL.md');

    expect(skill).toBeNull();
    expect(diagnostics.some((d) => d.includes('Failed to parse YAML frontmatter'))).toBe(true);
  });

  it('keeps optional fields out of parsed skill but accepts them', () => {
    const raw = `---
name: optional-fields
description: Skill with optional fields.
license: MIT
compatibility: Requires git.
metadata:
  author: test
  version: "1.0"
allowed-tools: Bash(git:*)
---

Body.`;

    const { skill, diagnostics } = parseSkillMarkdown(raw, '/skills/optional/SKILL.md');

    expect(diagnostics).toHaveLength(0);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('optional-fields');
    expect(skill!.content).toBe('Body.');
  });
});
