import type { Skill, SkillCatalog } from '../../sdk/skill-provider.js';

const SKILL_GUIDANCE = `The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the \`read_skill\` tool with the skill name
to load its full SKILL.md. Then follow the instructions inside the skill; if the skill
references additional files or commands, use the appropriate tools to gather more
information or execute actions.`;

export class DefaultSkillCatalog implements SkillCatalog {
  format(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    const skillBlocks = skills
      .map(
        (skill) =>
          `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
      )
      .join('\n');

    return [
      SKILL_GUIDANCE,
      '',
      '<available_skills>',
      skillBlocks,
      '</available_skills>',
    ].join('\n');
  }
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
