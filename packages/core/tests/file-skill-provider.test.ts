import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSkillProvider } from '../src/plugins/skill/file/index.js';
import { createDefaultAgentPaths } from '../src/config/paths.js';
import type { AgentPaths } from '../src/config/paths.js';
import type { ConfigProvider } from '../src/sdk/config-provider.js';

function makePaths(homeSkillsDir: string, agentDir: string): AgentPaths {
  return createDefaultAgentPaths({ homeSkillsDir, agentDir });
}

function mockConfigProvider(workspaceRoot: string): ConfigProvider {
  return {
    getBehaviorConfig: () => ({
      name: 'test',
      maxTurns: 60,
      workspaceRoot,
      readOnly: false,
      autoApproveDangerous: false,
      sessionsDir: '/tmp/.sessions',
    }),
    getModelConfig: () => ({ provider: 'openai', model: '', apiKey: '' }),
    getToolConfig: () => ({}),
    getMcpConfig: () => ({}),
    getConfig: () => ({
      name: 'test', maxTurns: 60, workspaceRoot, readOnly: false,
      autoApproveDangerous: false, sessionsDir: '/tmp/.sessions',
      model: { provider: 'openai', model: '', apiKey: '' },
    }),
  };
}

/** workspace skills live under <workspaceRoot>/.agents/skills/ */
function workspaceSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.agents', 'skills');
}

describe('FileSkillProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-skills-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSkill(skillsDir: string, name: string, description: string, body = '') {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  it('loads skills from home and workspace directories', async () => {
    const homeDir = join(tempDir, 'home');
    const workspaceRoot = join(tempDir, 'workspace-root');

    createSkill(homeDir, 'roll-dice', 'Roll dice.');
    createSkill(workspaceSkillsDir(workspaceRoot), 'pdf-processing', 'Handle PDFs.', 'Detailed PDF instructions.');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(workspaceRoot), paths);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['pdf-processing', 'roll-dice']);
  });

  it('workspace skills override home skills with same name', async () => {
    const homeDir = join(tempDir, 'home');
    const workspaceRoot = join(tempDir, 'workspace-root');

    createSkill(homeDir, 'shared', 'Home version.');
    createSkill(workspaceSkillsDir(workspaceRoot), 'shared', 'Workspace version.');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(workspaceRoot), paths);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('Workspace version.');
  });

  it('ignores directories without SKILL.md', async () => {
    const homeDir = join(tempDir, 'home');
    mkdirSync(join(homeDir, 'empty-skill'), { recursive: true });

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(0);
  });

  it('ignores hidden directories and node_modules', async () => {
    const homeDir = join(tempDir, 'home');
    createSkill(homeDir, 'valid', 'Valid skill.');
    mkdirSync(join(homeDir, '.hidden'));
    mkdirSync(join(homeDir, 'node_modules'));
    writeFileSync(join(homeDir, '.hidden', 'SKILL.md'), '---\nname: hidden\ndescription: Hidden.\n---\n');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid');
  });

  it('skips malformed skill files', async () => {
    const homeDir = join(tempDir, 'home');
    createSkill(homeDir, 'valid', 'Valid skill.');
    const badDir = join(homeDir, 'bad');
    mkdirSync(badDir);
    writeFileSync(join(badDir, 'SKILL.md'), '---\nname: bad\n---\n');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const skills = await provider.loadSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid');
  });

  it('returns empty array when directories do not exist', async () => {
    const paths = makePaths(join(tempDir, 'missing-home'), tempDir);
    const provider = new FileSkillProvider(
      mockConfigProvider(join(tempDir, 'missing-workspace')),
      paths,
    );
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(0);
  });

  it('formats catalog with XML block', async () => {
    const homeDir = join(tempDir, 'home');
    createSkill(homeDir, 'github', 'GitHub CLI for issues and PRs.');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const skills = await provider.loadSkills();
    const catalog = provider.formatCatalog(skills);

    expect(catalog).toContain('<available_skills>');
    expect(catalog).toContain('</skill>');
    expect(catalog).toContain('<name>github</name>');
    expect(catalog).toContain('GitHub CLI for issues and PRs.');
    expect(catalog).not.toContain('Detailed');
  });

  it('returns empty catalog string when no skills', async () => {
    const paths = makePaths(join(tempDir, 'home'), tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
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

  function createRawSkill(skillsDir: string, name: string, content: string) {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), content);
  }

  it('returns full SKILL.md raw content', async () => {
    const homeDir = join(tempDir, 'home');
    const raw = '---\nname: test\ndescription: Test skill.\n---\n\nBody here.';
    createRawSkill(homeDir, 'test', raw);

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const result = await provider.readSkillRaw('test');

    expect(result).toBe(raw);
  });

  it('prefers workspace skill over home skill', async () => {
    const homeDir = join(tempDir, 'home');
    const workspaceRoot = join(tempDir, 'workspace-root');

    createRawSkill(homeDir, 'shared', 'home raw');
    createRawSkill(workspaceSkillsDir(workspaceRoot), 'shared', 'workspace raw');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(workspaceRoot), paths);
    const result = await provider.readSkillRaw('shared');

    expect(result).toBe('workspace raw');
  });

  it('falls back to home skill when workspace skill is missing', async () => {
    const homeDir = join(tempDir, 'home');
    createRawSkill(homeDir, 'only-home', 'home raw');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const result = await provider.readSkillRaw('only-home');

    expect(result).toBe('home raw');
  });

  it('returns undefined when skill is not found in either directory', async () => {
    const paths = makePaths(join(tempDir, 'home'), tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const result = await provider.readSkillRaw('missing');

    expect(result).toBeUndefined();
  });

  it('returns undefined when SKILL.md is missing', async () => {
    const homeDir = join(tempDir, 'home');
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(join(homeDir, 'no-file'));
    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(join(tempDir, 'workspace')), paths);
    const result = await provider.readSkillRaw('no-file');

    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid names', async () => {
    const homeDir = join(tempDir, 'home');
    const workspaceRoot = join(tempDir, 'workspace-root');
    const escapeDir = join(tempDir, 'escape');
    mkdirSync(escapeDir);
    writeFileSync(join(escapeDir, 'SKILL.md'), 'escaped');

    createRawSkill(homeDir, 'valid', 'valid content');
    createRawSkill(homeDir, 'leading', 'leading content');
    createRawSkill(homeDir, 'trailing', 'trailing content');

    const paths = makePaths(homeDir, tempDir);
    const provider = new FileSkillProvider(mockConfigProvider(workspaceRoot), paths);

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
    expect(await provider.readSkillRaw('leading')).toBe('leading content');
    expect(await provider.readSkillRaw('trailing')).toBe('trailing content');
  });
});
