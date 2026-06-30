export interface Skill {
  name: string;
  description: string;
  location: string;
  content: string;
}

export interface SkillCatalog {
  format(skills: Skill[]): string;
}

export interface SkillProvider {
  loadSkills(): Promise<Skill[]>;
  formatCatalog(skills: Skill[]): string;
}
