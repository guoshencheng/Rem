import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';
import { DefaultSkillCatalog } from '../default-catalog.js';
import { parseSkillMarkdown } from '../../../utils/skill-parser.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';
import { getDefaultSkillsDir } from '../../../config/paths.js';

const REM_AGENT_SKILLS_DIR = 'REM_AGENT_SKILLS_DIR';

export interface FileSkillProviderOptions {
  skillsDir: string;
}

export class FileSkillProvider implements SkillProvider {
  private skillsDir: string;
  private catalog = new DefaultSkillCatalog();

  constructor(options?: Partial<FileSkillProviderOptions>) {
    this.skillsDir = options?.skillsDir ?? resolveDefaultSkillsDir();
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

  async readSkillRaw(name: string): Promise<string | undefined> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return undefined;
    }

    if (this.skillsDir === '') {
      return undefined;
    }

    const skillDir = join(this.skillsDir, name);
    const skillFile = join(skillDir, 'SKILL.md');

    try {
      const entryStat = await stat(skillDir);
      if (!entryStat.isDirectory()) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    try {
      return await readFile(skillFile, 'utf-8');
    } catch {
      return undefined;
    }
  }
}

export function createProvider(options?: Partial<FileSkillProviderOptions>): FileSkillProvider {
  return new FileSkillProvider(options);
}

export function getDefaultOptions(_ctx: ProviderLoaderContext): Partial<FileSkillProviderOptions> {
  return { skillsDir: resolveDefaultSkillsDir() };
}

function resolveDefaultSkillsDir(): string {
  const envDir = process.env[REM_AGENT_SKILLS_DIR];
  if (envDir) {
    return envDir;
  }
  return getDefaultSkillsDir();
}
