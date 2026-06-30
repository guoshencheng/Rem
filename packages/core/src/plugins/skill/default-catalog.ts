import type { Skill, SkillCatalog } from '../../sdk/skill-provider.js';

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
      'The following skills provide specialized instructions for specific tasks.',
      'When a task matches a skill\'s description, use your file-read tool to load',
      'the SKILL.md at the listed location before proceeding.',
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
