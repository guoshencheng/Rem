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

describe('FileSkillProvider.readSkillRaw', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-skill-raw-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createRawSkill(name: string, content: string) {
    const skillDir = join(tempDir, name);
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  it('returns full SKILL.md raw content', async () => {
    const raw = '---\nname: test\ndescription: Test skill.\n---\n\nBody here.';
    createRawSkill('test', raw);

    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const result = await provider.readSkillRaw('test');

    expect(result).toBe(raw);
  });

  it('returns undefined when skill is not found', async () => {
    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const result = await provider.readSkillRaw('missing');

    expect(result).toBeUndefined();
  });

  it('returns undefined when skillsDir is empty', async () => {
    const provider = new FileSkillProvider();
    const result = await provider.readSkillRaw('anything');

    expect(result).toBeUndefined();
  });

  it('returns undefined when SKILL.md is missing', async () => {
    mkdirSync(join(tempDir, 'no-file'));
    const provider = new FileSkillProvider({ skillsDir: tempDir });
    const result = await provider.readSkillRaw('no-file');

    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid names', async () => {
    const skillsDir = join(tempDir, 'skills');
    mkdirSync(skillsDir);
    const escapeDir = join(tempDir, 'escape');
    mkdirSync(escapeDir);
    writeFileSync(join(escapeDir, 'SKILL.md'), 'escaped');

    function createRawSkillInSkillsDir(name: string, content: string) {
      const skillDir = join(skillsDir, name);
      mkdirSync(skillDir);
      writeFileSync(join(skillDir, 'SKILL.md'), content);
    }
    createRawSkillInSkillsDir('valid', 'valid content');

    const provider = new FileSkillProvider({ skillsDir });

    expect(await provider.readSkillRaw('../escape')).toBeUndefined();
    expect(await provider.readSkillRaw('foo/bar')).toBeUndefined();
    expect(await provider.readSkillRaw('foo\\bar')).toBeUndefined();
    expect(await provider.readSkillRaw('.')).toBeUndefined();
    expect(await provider.readSkillRaw(' leading')).toBeUndefined();
    expect(await provider.readSkillRaw('trailing ')).toBeUndefined();
    expect(await provider.readSkillRaw('name\0hidden')).toBeUndefined();
    expect(await provider.readSkillRaw('')).toBeUndefined();
    expect(await provider.readSkillRaw('   ')).toBeUndefined();
    expect(await provider.readSkillRaw('valid')).toBe('valid content');
  });
});
