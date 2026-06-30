import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';
import { DefaultSkillCatalog } from '../default-catalog.js';
import { parseSkillMarkdown } from '../../../utils/skill-parser.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

export interface FileSkillProviderOptions {
  skillsDir: string;
}

export class FileSkillProvider implements SkillProvider {
  private skillsDir: string;
  private catalog = new DefaultSkillCatalog();

  constructor(options?: Partial<FileSkillProviderOptions>) {
    this.skillsDir = options?.skillsDir ?? '';
  }

  async loadSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];
    if (this.skillsDir === '') {
      return skills;
    }

    let entries: string[];
    try {
      const dirStat = await stat(this.skillsDir);
      if (!dirStat.isDirectory()) {
        return skills;
      }
      entries = await readdir(this.skillsDir);
    } catch {
      return skills;
    }

    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') {
        continue;
      }

      const skillDir = join(this.skillsDir, entry);
      const skillFile = join(skillDir, 'SKILL.md');

      let fileContent: string;
      try {
        const entryStat = await stat(skillDir);
        if (!entryStat.isDirectory()) {
          continue;
        }
        fileContent = await readFile(skillFile, 'utf-8');
      } catch {
        continue;
      }

      const { skill } = parseSkillMarkdown(fileContent, skillFile);
      if (skill) {
        skills.push(skill);
      }
    }

    return skills;
  }

  formatCatalog(skills: Skill[]): string {
    return this.catalog.format(skills);
  }
}

export function createProvider(options?: Partial<FileSkillProviderOptions>): FileSkillProvider {
  return new FileSkillProvider(options);
}

export function getDefaultOptions(ctx: ProviderLoaderContext): Partial<FileSkillProviderOptions> {
  return { skillsDir: ctx.skillsDir };
}
