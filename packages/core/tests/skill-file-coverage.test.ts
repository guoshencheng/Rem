import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseSkillMarkdown } from '../src/plugins/skill/skill-parser.js';
import { StaticToolProvider, type CustomTool } from '../src/plugins/tool/static/index.js';
import { FileSkillProvider } from '../src/plugins/skill/file/index.js';
import type { ConfigProvider, ResolvedAgentRole, ResolvedModelConfig, ResolvedAgentConfig, TeamInfo } from '../src/sdk/config-provider.js';
import type { AgentPaths } from '../src/infrastructure/config/paths.js';
import type { ToolDefinition, ToolCall, ToolContext, ToolExecutor } from '../src/sdk/tool-provider.js';
import { Type } from '@sinclair/typebox';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── skill-parser ───────────────────────────────────────────────

describe('parseSkillMarkdown', () => {
  it('parses valid skill markdown', () => {
    const result = parseSkillMarkdown(`---
name: test-skill
description: A test skill
---
# Body content`, '/fake/SKILL.md');
    expect(result.skill).toEqual({
      name: 'test-skill',
      description: 'A test skill',
      location: '/fake/SKILL.md',
      content: '# Body content',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('returns null when frontmatter is missing', () => {
    const result = parseSkillMarkdown('no frontmatter', '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('YAML frontmatter');
  });

  it('returns null when frontmatter closing delimiter is missing', () => {
    const result = parseSkillMarkdown(`---
name: test
description: test
no closing`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('closing delimiter');
  });

  it('handles YAML parse errors', () => {
    const result = parseSkillMarkdown(`---
name: [malformed
description: test
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('Failed to parse YAML');
  });

  it('returns null when description is missing', () => {
    const result = parseSkillMarkdown(`---
name: test
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('missing required "description"');
  });

  it('returns null when description is empty', () => {
    const result = parseSkillMarkdown(`---
name: test
description:  
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('missing required "description"');
  });

  it('returns null when name is missing', () => {
    const result = parseSkillMarkdown(`---
description: test
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('missing required "name"');
  });

  it('returns null when name is empty string', () => {
    const result = parseSkillMarkdown(`---
name:  
description: test
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
    expect(result.diagnostics[0]).toContain('missing required "name"');
  });

  it('handles leading whitespace before frontmatter', () => {
    const result = parseSkillMarkdown(`

---
name: spaced
description: has leading whitespace
---
body`, '/fake/SKILL.md');
    expect(result.skill?.name).toBe('spaced');
  });

  it('handles non-string name/description types', () => {
    const result = parseSkillMarkdown(`---
name: 123
description: test
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
  });

  it('uses empty frontmatter object when YAML parses to null', () => {
    const result = parseSkillMarkdown(`---
---
body`, '/fake/SKILL.md');
    expect(result.skill).toBeNull();
  });
});

// ─── static tool provider ────────────────────────────────────────

const sampleParam = Type.Object({ text: Type.String() });
const sampleDef: ToolDefinition<typeof sampleParam> = {
  name: 'sample', description: 'sample tool', parameters: sampleParam,
};
const ctx: ToolContext = { cwd: '/', workspaceRoot: '/' };

describe('StaticToolProvider', () => {
  it('registers via constructor array', () => {
    const provider = new StaticToolProvider([{ definition: sampleDef, executor: vi.fn().mockResolvedValue({ output: 'ok' }) }]);
    expect(provider.getToolDefinition('sample')?.name).toBe('sample');
  });

  it('register method adds tool', () => {
    const provider = new StaticToolProvider();
    provider.register(sampleDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    expect(provider.getToolDefinition('sample')?.name).toBe('sample');
  });

  it('getToolSet returns tools', () => {
    const provider = new StaticToolProvider();
    provider.register(sampleDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    const toolSet = provider.getToolSet();
    expect(toolSet).toHaveLength(1);
    expect(toolSet[0].name).toBe('sample');
  });

  it('isDangerous returns definition value', () => {
    const provider = new StaticToolProvider();
    const dangerDef: ToolDefinition = { name: 'danger', description: 'd', parameters: Type.Object({}), dangerous: true };
    provider.register(dangerDef, vi.fn().mockResolvedValue({ output: 'ok' }));
    expect(provider.isDangerous('danger')).toBe(true);
    expect(provider.isDangerous('safe')).toBe(false);
  });

  it('execute runs executor for known tool', async () => {
    const executor = vi.fn().mockResolvedValue({ output: 'result' });
    const provider = new StaticToolProvider([{ definition: sampleDef, executor }]);
    const results = await provider.execute(
      [{ toolCallId: '1', toolName: 'sample', input: { text: 'hi' } }],
      ctx,
    );
    expect(results[0].output).toBe('result');
    expect(executor).toHaveBeenCalled();
  });

  it('execute returns error for unknown tool', async () => {
    const provider = new StaticToolProvider();
    const results = await provider.execute(
      [{ toolCallId: '1', toolName: 'ghost', input: {} }],
      ctx,
    );
    expect(results[0].error).toContain('unknown tool');
  });

  it('execute catches executor errors', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('fail'));
    const provider = new StaticToolProvider([{ definition: sampleDef, executor }]);
    const results = await provider.execute(
      [{ toolCallId: '1', toolName: 'sample', input: { text: 'hi' } }],
      ctx,
    );
    expect(results[0].error).toBe('fail');
  });

  it('execute catches non-Error executor errors', async () => {
    const executor = vi.fn().mockRejectedValue('string err');
    const provider = new StaticToolProvider([{ definition: sampleDef, executor }]);
    const results = await provider.execute(
      [{ toolCallId: '1', toolName: 'sample', input: { text: 'hi' } }],
      ctx,
    );
    expect(results[0].error).toBe('string err');
  });

  it('execute includes details in result', async () => {
    const executor = vi.fn().mockResolvedValue({ output: 'out', details: { extra: 1 } });
    const provider = new StaticToolProvider([{ definition: sampleDef, executor }]);
    const results = await provider.execute(
      [{ toolCallId: '1', toolName: 'sample', input: { text: 'hi' } }],
      ctx,
    );
    expect(results[0].details).toEqual({ extra: 1 });
  });

  it('getToolDefinition returns undefined for unknown', () => {
    const provider = new StaticToolProvider();
    expect(provider.getToolDefinition('unknown')).toBeUndefined();
  });
});

// ─── file skill provider ────────────────────────────────────────

class FakeConfigProvider implements ConfigProvider {
  getBehaviorConfig() {
    return { workspaceRoot: '/ws', name: 'Test', maxTurns: 5, readOnly: false, autoApproveDangerous: true,
      compression: { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 } };
  }
  async init() {}
  getConfig() { return {} as ResolvedAgentConfig; }
  getModelConfig(): ResolvedModelConfig { return { provider: 'mock', model: 'mock', apiKey: 'key' }; }
  getToolConfig() { return {}; }
  getCompressionConfig() { return { enabled: false, thresholdRatio: 0.8, protectHead: 4, protectTail: 8 }; }
  resolveAgent(id?: string): ResolvedAgentRole { return { id: id ?? 'default', name: 'Agent', corePrompt: '' }; }
  resolveTeam() { throw new Error('not implemented'); }
  listTeams(): TeamInfo[] { return []; }
  getOrchestrationConfig() { return { maxAgentRuns: 20, maxMessages: 50, maxDepth: 8, timeoutMs: 300_000, maxTokens: 200_000, maxParallelAgents: 4 }; }
}

describe('FileSkillProvider', () => {
  let tmpDir: string;
  let homeSkillsDir: string;
  let wsSkillsDir: string;
  let config: ConfigProvider;
  let paths: AgentPaths;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skill-test-'));
    homeSkillsDir = join(tmpDir, 'home-skills');
    wsSkillsDir = join(tmpDir, 'ws-skills');
    config = new FakeConfigProvider();
    paths = {
      agentDir: tmpDir,
      homeSkillsDir,
      workspaceSkillsDir: () => wsSkillsDir,
      configCandidates: () => [],
      homeConfigCandidates: () => [],
      workspaceConfigCandidates: () => [],
      debugLogFile: null,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function createSkill(dir: string, name: string, content: string) {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), content);
  }

  it('loadSkills returns sorted merged skills from both dirs', async () => {
    await createSkill(homeSkillsDir, 'b-home', `---
name: b-home
description: Home skill
---
Home body`);
    await createSkill(wsSkillsDir, 'a-ws', `---
name: a-ws
description: WS skill
---
WS body`);
    const provider = new FileSkillProvider(config, paths);
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(2);
    // Sorted by name
    expect(skills[0].name).toBe('a-ws');
    expect(skills[1].name).toBe('b-home');
  });

  it('workspace skills override home skills with same name', async () => {
    await createSkill(homeSkillsDir, 'shared', `---
name: shared
description: Home version
---
Home`);
    await createSkill(wsSkillsDir, 'shared', `---
name: shared
description: WS version
---
WS`);
    const provider = new FileSkillProvider(config, paths);
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe('WS version');
  });

  it('returns empty array when skills dirs do not exist', async () => {
    const provider = new FileSkillProvider(config, paths);
    const skills = await provider.loadSkills();
    expect(skills).toEqual([]);
  });

  it('skips entries starting with dot and node_modules', async () => {
    await mkdir(join(homeSkillsDir, '.hidden'), { recursive: true });
    await createSkill(homeSkillsDir, 'visible', `---
name: visible
description: Valid
---
body`);
    const provider = new FileSkillProvider(config, paths);
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('visible');
  });

  it('skips entries that are files (not dirs)', async () => {
    await mkdir(homeSkillsDir, { recursive: true });
    await writeFile(join(homeSkillsDir, 'README.md'), 'some content');
    await createSkill(homeSkillsDir, 'valid', `---
name: valid
description: Valid
---
body`);
    const provider = new FileSkillProvider(config, paths);
    const skills = await provider.loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('valid');
  });

  it('skips directories without SKILL.md', async () => {
    await mkdir(join(homeSkillsDir, 'no-skill'), { recursive: true });
    await writeFile(join(homeSkillsDir, 'no-skill', 'README.md'), 'not a skill');
    const provider = new FileSkillProvider(config, paths);
    const skills = await provider.loadSkills();
    expect(skills).toEqual([]);
  });

  it('formatCatalog delegates to catalog', () => {
    const provider = new FileSkillProvider(config, paths);
    const formatted = provider.formatCatalog([{ name: 's', description: 'd', location: 'loc', content: 'c' }]);
    expect(formatted).toContain('<available_skills>');
    expect(formatted).toContain('<skill>');
    expect(formatted).toContain('s');
  });

  it('formatCatalog returns empty for no skills', () => {
    const provider = new FileSkillProvider(config, paths);
    expect(provider.formatCatalog([])).toBe('');
  });

  it('readSkillRaw returns undefined for invalid name', async () => {
    const provider = new FileSkillProvider(config, paths);
    expect(await provider.readSkillRaw('bad/name')).toBeUndefined();
  });

  it('readSkillRaw reads from workspace first then home', async () => {
    await createSkill(wsSkillsDir, 'myskill', `---
name: myskill
description: WS version
---
WS body`);
    await createSkill(homeSkillsDir, 'myskill', `---
name: myskill
description: Home version
---
Home body`);
    const provider = new FileSkillProvider(config, paths);
    const raw = await provider.readSkillRaw('myskill');
    expect(raw).toContain('WS body');
  });

  it('readSkillRaw falls back to home when not in workspace', async () => {
    await createSkill(homeSkillsDir, 'onlyhome', `---
name: onlyhome
description: Home
---
Home body`);
    const provider = new FileSkillProvider(config, paths);
    const raw = await provider.readSkillRaw('onlyhome');
    expect(raw).toContain('Home body');
  });

  it('readSkillRaw returns undefined when skill not found', async () => {
    const provider = new FileSkillProvider(config, paths);
    expect(await provider.readSkillRaw('nonexistent')).toBeUndefined();
  });

  it('readSkillRaw returns undefined when name resolves to file not directory', async () => {
    await mkdir(wsSkillsDir, { recursive: true });
    await writeFile(join(wsSkillsDir, 'myskill'), 'not a dir');
    const provider = new FileSkillProvider(config, paths);
    expect(await provider.readSkillRaw('myskill')).toBeUndefined();
  });

  it('readSkillRaw returns undefined when SKILL.md is missing in subdir', async () => {
    await mkdir(join(wsSkillsDir, 'noskill'), { recursive: true });
    const provider = new FileSkillProvider(config, paths);
    expect(await provider.readSkillRaw('noskill')).toBeUndefined();
  });

  it('loadSkills handles non-directory skills dir gracefully', async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(join(tmpDir, 'ws-skills'), 'not a dir');
    const provider = new FileSkillProvider(config, { ...paths, workspaceSkillsDir: () => join(tmpDir, 'ws-skills') });
    const skills = await provider.loadSkills();
    expect(skills).toEqual([]);
  });

  it('handles empty skills dir gracefully', async () => {
    const emptyPaths: AgentPaths = { ...paths, homeSkillsDir: '', workspaceSkillsDir: () => '' };
    const provider = new FileSkillProvider(config, emptyPaths);
    const skills = await provider.loadSkills();
    expect(skills).toEqual([]);
    expect(await provider.readSkillRaw('any')).toBeUndefined();
  });
});
