import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';

export class EmptySkillProvider implements SkillProvider {
  constructor(private skills: Skill[] = []) {}

  async loadSkills(): Promise<Skill[]> {
    return this.skills;
  }

  formatCatalog(skills: Skill[]): string {
    return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  }

  async readSkillRaw(name: string): Promise<string | undefined> {
    return this.skills.find((s) => s.name === name)?.content;
  }
}
