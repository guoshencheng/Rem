import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSkillProvider } from '../src/plugins/skill/file/index.js';

describe('FileSkillProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-skills-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(name: string, description: string, body = '') {
    const skillDir = join(tempDir, name);
    mkdirSync(skillDir);
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  it('loads skills from a directory', async () => {
    createSkill('roll-dice', 'Roll dice.');
    createSkill('pdf-processing', 'Handle PDFs.', 'Detailed PDF instructions.');

    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['pdf-processing', 'roll-dice']);
    expect(skills[0].description).toBeDefined();
    expect(skills[0].location).toContain('SKILL.md');
    expect(skills.find((s) => s.name === 'pdf-processing')!.content).toContain('Detailed PDF instructions.');
  });

  it('ignores directories without SKILL.md', async () => {
    mkdirSync(join(tempDir, 'empty-skill'));
    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(0);
  });

  it('ignores hidden directories and node_modules', async () => {
    createSkill('valid', 'Valid skill.');
    mkdirSync(join(tempDir, '.hidden'));
    mkdirSync(join(tempDir, 'node_modules'));
    writeFileSync(join(tempDir, '.hidden', 'SKILL.md'), '---\nname: hidden\ndescription: Hidden.\n---\n');

    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid');
  });

  it('skips malformed skill files', async () => {
    createSkill('valid', 'Valid skill.');
    const badDir = join(tempDir, 'bad');
    mkdirSync(badDir);
    writeFileSync(join(badDir, 'SKILL.md'), '---\nname: bad\n---\n');

    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid');
  });

  it('returns empty array when directory does not exist', async () => {
    const provider = new FileSkillProvider({ skillsDir: join(tempDir, 'missing') });
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(0);
  });

  it('formats catalog with XML block', async () => {
    createSkill('github', 'GitHub CLI for issues and PRs.');

    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const skills = await provider.loadSkills();
    const catalog = provider.formatCatalog(skills);

    expect(catalog).toContain('<available_skills>');
    expect(catalog).toContain('</skill>');
    expect(catalog).toContain('<name>github</name>');
    expect(catalog).toContain('GitHub CLI for issues and PRs.');
    expect(catalog).not.toContain('Detailed');
  });

  it('returns empty catalog string when no skills', async () => {
    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const catalog = provider.formatCatalog([]);
    expect(catalog).toBe('');
  });
});
