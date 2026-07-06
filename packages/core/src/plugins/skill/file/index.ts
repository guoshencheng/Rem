import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { Skill, SkillProvider } from '../../../sdk/skill-provider.js';
import { DefaultSkillCatalog } from '../default-catalog.js';
import { parseSkillMarkdown } from '../../../utils/skill-parser.js';
import type { ProviderLoaderContext } from '../../../sdk/provider-loader.js';

const AGENT_DIR_NAME = '.agent';
const SKILLS_DIR_NAME = 'skills';

export interface FileSkillProviderOptions {
  homeSkillsDir?: string;
  workspaceSkillsDir?: string;
}

export class FileSkillProvider implements SkillProvider {
  private homeSkillsDir: string;
  private workspaceSkillsDir: string;
  private catalog = new DefaultSkillCatalog();

  constructor(options?: Partial<FileSkillProviderOptions>) {
    this.homeSkillsDir = options?.homeSkillsDir ?? resolveHomeSkillsDir();
    this.workspaceSkillsDir = options?.workspaceSkillsDir ?? resolveWorkspaceSkillsDir(process.cwd());
  }

  async loadSkills(): Promise<Skill[]> {
    const homeSkills = await this.loadSkillsFromDir(this.homeSkillsDir);
    const workspaceSkills = await this.loadSkillsFromDir(this.workspaceSkillsDir);

    const merged = new Map<string, Skill>();
    for (const skill of homeSkills) {
      merged.set(skill.name, skill);
    }
    for (const skill of workspaceSkills) {
      merged.set(skill.name, skill);
    }

    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  formatCatalog(skills: Skill[]): string {
    return this.catalog.format(skills);
  }

  async readSkillRaw(name: string): Promise<string | undefined> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return undefined;
    }

    const workspaceRaw = await this.readSkillRawFromDir(name, this.workspaceSkillsDir);
    if (workspaceRaw !== undefined) {
      return workspaceRaw;
    }

    return this.readSkillRawFromDir(name, this.homeSkillsDir);
  }

  private async loadSkillsFromDir(skillsDir: string): Promise<Skill[]> {
    const skills: Skill[] = [];
    if (skillsDir === '') {
      return skills;
    }

    let entries: string[];
    try {
      const dirStat = await stat(skillsDir);
      if (!dirStat.isDirectory()) {
        return skills;
      }
      entries = await readdir(skillsDir);
    } catch {
      return skills;
    }

    for (const entry of entries.sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') {
        continue;
      }

      const skillDir = join(skillsDir, entry);
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

  private async readSkillRawFromDir(name: string, skillsDir: string): Promise<string | undefined> {
    if (skillsDir === '') {
      return undefined;
    }

    const skillDir = join(skillsDir, name);
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

export function getDefaultOptions(ctx: ProviderLoaderContext): Partial<FileSkillProviderOptions> {
  return {
    homeSkillsDir: resolveHomeSkillsDir(),
    workspaceSkillsDir: resolveWorkspaceSkillsDir(ctx.workspaceRoot),
  };
}

function resolveHomeSkillsDir(): string {
  return join(homedir(), AGENT_DIR_NAME, SKILLS_DIR_NAME);
}

function resolveWorkspaceSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, AGENT_DIR_NAME, SKILLS_DIR_NAME);
}
