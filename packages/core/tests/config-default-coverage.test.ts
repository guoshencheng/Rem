import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  isObject, resolveTemplate, resolveOptionalTemplate, isThinkingLevel,
  pickToolPolicy, pickModelConfig, pickModels,
  pickCustomAgentConfig, pickAgents, pickTeams,
  pickOrchestrationConfig, pickCompressionConfig,
} from '../src/plugins/config/default/config-parser.js';
import { loadConfigFile, loadConfigFileSync, resolveConfigPaths } from '../src/plugins/config/default/config-loader.js';
import { mergeFileConfig, mergeEnvConfig, applyBehaviorDefaults, mergeDeepConfig } from '../src/plugins/config/default/config-merger.js';
import { DefaultConfigProvider } from '../src/plugins/config/default/index.js';
import { createDefaultAgentPaths } from '../src/infrastructure/config/paths.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentConfig } from '../src/sdk/config-provider.js';
import type { AgentPaths } from '../src/infrastructure/config/paths.js';

// ─── config-parser ──────────────────────────────────────────────

describe('isObject', () => {
  it('true for plain objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it('false for null', () => {
    expect(isObject(null)).toBe(false);
  });

  it('false for arrays', () => {
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2, 3])).toBe(false);
  });

  it('false for primitives', () => {
    expect(isObject('string')).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe('resolveTemplate', () => {
  it('resolves ${VAR} in string', () => {
    const env = { HOME: '/home/user', USER: 'me' } as NodeJS.ProcessEnv;
    expect(resolveTemplate('Path is ${HOME}', env)).toBe('Path is /home/user');
  });

  it('replaces missing var with empty string', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveTemplate('Hello ${MISSING} world', env)).toBe('Hello  world');
  });

  it('resolves multiple vars', () => {
    const env = { A: '1', B: '2' } as NodeJS.ProcessEnv;
    expect(resolveTemplate('${A} ${B}', env)).toBe('1 2');
  });

  it('leaves literal dollar unchanged', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveTemplate('Cost $5', env)).toBe('Cost $5');
  });
});

describe('resolveOptionalTemplate', () => {
  it('returns undefined for undefined input', () => {
    expect(resolveOptionalTemplate(undefined, {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('resolves template normally', () => {
    const env = { KEY: 'value' } as NodeJS.ProcessEnv;
    expect(resolveOptionalTemplate('${KEY}', env)).toBe('value');
  });

  it('returns undefined when result is empty string', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveOptionalTemplate('${MISSING}', env)).toBeUndefined();
  });

  it('returns defined value when some vars resolve', () => {
    const env = { A: 'hello' } as NodeJS.ProcessEnv;
    expect(resolveOptionalTemplate('${A}${B}', env)).toBe('hello');
  });
});

describe('isThinkingLevel', () => {
  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])('%s is valid', (level) => {
    expect(isThinkingLevel(level)).toBe(true);
  });

  it.each(['none', 'extreme', '', 'HIGH', 'minimalmax'])('%s is invalid', (level) => {
    expect(isThinkingLevel(level)).toBe(false);
  });

  it('false for non-strings', () => {
    expect(isThinkingLevel(42)).toBe(false);
    expect(isThinkingLevel(null)).toBe(false);
    expect(isThinkingLevel({})).toBe(false);
    expect(isThinkingLevel(undefined)).toBe(false);
  });
});

describe('pickToolPolicy', () => {
  it('returns undefined for non-object', () => {
    expect(pickToolPolicy(null)).toBeUndefined();
    expect(pickToolPolicy('string')).toBeUndefined();
    expect(pickToolPolicy(42)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(pickToolPolicy({})).toBeUndefined();
  });

  it('picks primitive fields', () => {
    const result = pickToolPolicy({
      profile: 'minimal',
      allow: ['read', 'write'],
      alsoAllow: ['extra'],
      deny: ['rm'],
    });
    expect(result).toEqual({
      profile: 'minimal',
      allow: ['read', 'write'],
      alsoAllow: ['extra'],
      deny: ['rm'],
    });
  });

  it('picks byProvider recursively', () => {
    const result = pickToolPolicy({
      byProvider: {
        openai: { allow: ['read'] },
        anthropic: { deny: ['write'] },
      },
    });
    expect(result).toEqual({
      byProvider: {
        openai: { allow: ['read'] },
        anthropic: { deny: ['write'] },
      },
    });
  });

  it('preserves byProvider with empty nested policies', () => {
    const result = pickToolPolicy({
      byProvider: { openai: {} },
    });
    expect(result).toEqual({
      byProvider: { openai: {} },
    });
  });

  it('picks toolsBySender recursively', () => {
    const result = pickToolPolicy({
      toolsBySender: {
        root: { allow: ['all'] },
        sub: { deny: ['dangerous'] },
      },
    });
    expect(result).toEqual({
      toolsBySender: {
        root: { allow: ['all'] },
        sub: { deny: ['dangerous'] },
      },
    });
  });

  it('picks sandbox with mode and tools', () => {
    const result = pickToolPolicy({
      sandbox: { mode: 'all', tools: { allow: ['read'] } },
    });
    expect(result).toEqual({
      sandbox: { mode: 'all', tools: { allow: ['read'] } },
    });
  });

  it('picks sandbox with only mode', () => {
    const result = pickToolPolicy({
      sandbox: { mode: 'non-main' },
    });
    expect(result).toEqual({
      sandbox: { mode: 'non-main' },
    });
  });

  it('ignores non-string profile', () => {
    const result = pickToolPolicy({ profile: 42 });
    expect(result).toBeUndefined();
  });

  it('ignores non-array allow/deny', () => {
    const result = pickToolPolicy({ allow: 'not-array', deny: 123 });
    expect(result).toBeUndefined();
  });
});

describe('pickModelConfig', () => {
  it('returns undefined for non-object', () => {
    expect(pickModelConfig(null)).toBeUndefined();
  });

  it('returns undefined when provider is missing', () => {
    expect(pickModelConfig({ model: 'gpt-4' })).toBeUndefined();
    expect(pickModelConfig({ provider: '' })).toBeUndefined();
  });

  it('picks provider and model', () => {
    expect(pickModelConfig({ provider: 'openai', model: 'gpt-4' })).toEqual({
      provider: 'openai', model: 'gpt-4',
    });
  });

  it('picks apiKey and baseURL', () => {
    const cfg = pickModelConfig({
      provider: 'openai', model: 'gpt-4',
      apiKey: 'sk-xxx', baseURL: 'https://custom.api',
    });
    expect(cfg).toEqual({
      provider: 'openai', model: 'gpt-4',
      apiKey: 'sk-xxx', baseURL: 'https://custom.api',
    });
  });

  it('picks reasoning when valid thinking level', () => {
    const cfg = pickModelConfig({
      provider: 'openai', model: 'gpt-4', reasoning: 'high',
    });
    expect(cfg?.reasoning).toBe('high');
  });

  it('ignores invalid reasoning', () => {
    const cfg = pickModelConfig({
      provider: 'openai', model: 'gpt-4', reasoning: 'unknown',
    });
    expect(cfg?.reasoning).toBeUndefined();
  });

  it('provider defaults to empty model', () => {
    const cfg = pickModelConfig({ provider: 'openai' });
    expect(cfg).toEqual({ provider: 'openai', model: '' });
  });
});

describe('pickModels', () => {
  it('returns undefined for non-object', () => {
    expect(pickModels(null)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(pickModels({})).toBeUndefined();
  });

  it('picks multiple model configs', () => {
    const result = pickModels({
      a: { provider: 'openai', model: 'gpt-4' },
      b: { provider: 'anthropic', model: 'claude-3' },
    });
    expect(result).toEqual({
      a: { provider: 'openai', model: 'gpt-4' },
      b: { provider: 'anthropic', model: 'claude-3' },
    });
  });

  it('skips entries without provider', () => {
    const result = pickModels({
      a: { provider: 'openai', model: 'gpt-4' },
      b: { model: 'claude-3' },
    });
    expect(result).toEqual({ a: { provider: 'openai', model: 'gpt-4' } });
  });

  it('returns undefined when all entries invalid', () => {
    expect(pickModels({ a: { model: 'gpt-4' } })).toBeUndefined();
  });
});

describe('pickCustomAgentConfig', () => {
  it('returns undefined for non-object', () => {
    expect(pickCustomAgentConfig(null)).toBeUndefined();
  });

  it('returns undefined when name is missing', () => {
    expect(pickCustomAgentConfig({ corePrompt: 'help' })).toBeUndefined();
  });

  it('returns undefined when corePrompt is missing', () => {
    expect(pickCustomAgentConfig({ name: 'test' })).toBeUndefined();
  });

  it('picks name and corePrompt', () => {
    expect(pickCustomAgentConfig({ name: 'helper', corePrompt: 'help users' })).toEqual({
      name: 'helper', corePrompt: 'help users',
    });
  });

  it('picks model when present', () => {
    const cfg = pickCustomAgentConfig({
      name: 'helper', corePrompt: 'help',
      model: { provider: 'openai', model: 'gpt-4' },
    });
    expect(cfg).toEqual({
      name: 'helper', corePrompt: 'help',
      model: { provider: 'openai', model: 'gpt-4' },
    });
  });
});

describe('pickAgents', () => {
  it('returns undefined for non-object', () => {
    expect(pickAgents(null)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(pickAgents({})).toBeUndefined();
  });

  it('picks multiple agents', () => {
    const result = pickAgents({
      a: { name: 'Agent A', corePrompt: 'do a' },
      b: { name: 'Agent B', corePrompt: 'do b' },
    });
    expect(result).toEqual({
      a: { name: 'Agent A', corePrompt: 'do a' },
      b: { name: 'Agent B', corePrompt: 'do b' },
    });
  });

  it('skips invalid agents', () => {
    const result = pickAgents({
      a: { name: 'A', corePrompt: 'do a' },
      b: { corePrompt: 'no name' },
      c: { name: 'no prompt' },
    });
    expect(result).toEqual({ a: { name: 'A', corePrompt: 'do a' } });
  });
});

describe('pickTeams', () => {
  it('returns undefined for non-object', () => {
    expect(pickTeams(null)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(pickTeams({})).toBeUndefined();
  });

  it('picks valid team configs', () => {
    const result = pickTeams({
      team1: { organizer: 'org', members: ['mem1', 'mem2'] },
    });
    expect(result).toEqual({
      team1: { organizer: 'org', members: ['mem1', 'mem2'] },
    });
  });

  it('skips non-object entries', () => {
    expect(pickTeams({ team1: 'not-an-object' })).toBeUndefined();
  });

  it('skips entries without string organizer', () => {
    const result = pickTeams({
      team1: { organizer: 42, members: ['a'] },
    });
    expect(result).toBeUndefined();
  });

  it('skips entries without members array', () => {
    const result = pickTeams({
      team1: { organizer: 'org', members: 'not-array' },
    });
    expect(result).toBeUndefined();
  });

  it('skips entries with non-string members', () => {
    const result = pickTeams({
      team1: { organizer: 'org', members: ['valid', 42] },
    });
    expect(result).toBeUndefined();
  });
});

describe('pickOrchestrationConfig', () => {
  it('returns undefined for non-object', () => {
    expect(pickOrchestrationConfig(null)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(pickOrchestrationConfig({})).toBeUndefined();
  });

  it('picks all numeric fields', () => {
    const result = pickOrchestrationConfig({
      maxAgentRuns: 10,
      maxMessages: 20,
      maxDepth: 5,
      timeoutMs: 60000,
      maxTokens: 100000,
      maxParallelAgents: 3,
    });
    expect(result).toEqual({
      maxAgentRuns: 10, maxMessages: 20, maxDepth: 5,
      timeoutMs: 60000, maxTokens: 100000, maxParallelAgents: 3,
    });
  });

  it('picks partial fields', () => {
    const result = pickOrchestrationConfig({ maxAgentRuns: 5 });
    expect(result).toEqual({ maxAgentRuns: 5 });
  });

  it('ignores non-number fields', () => {
    const result = pickOrchestrationConfig({ maxAgentRuns: '10' });
    expect(result).toBeUndefined();
  });
});

describe('pickCompressionConfig', () => {
  it('returns undefined for non-object', () => {
    expect(pickCompressionConfig(null)).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(pickCompressionConfig({})).toBeUndefined();
  });

  it('picks all fields', () => {
    const result = pickCompressionConfig({
      enabled: true, thresholdRatio: 0.5,
      protectHead: 5, protectTail: 10,
    });
    expect(result).toEqual({
      enabled: true, thresholdRatio: 0.5, protectHead: 5, protectTail: 10,
    });
  });

  it('picks partial fields', () => {
    const result = pickCompressionConfig({ enabled: false });
    expect(result).toEqual({ enabled: false });
  });

  it('ignores non-matching types', () => {
    const result = pickCompressionConfig({ enabled: 'yes', thresholdRatio: '0.5' });
    expect(result).toBeUndefined();
  });
});

// ─── config-loader ──────────────────────────────────────────────

describe('config-loader', () => {
  let tmpDir: string;

  function writeTempFile(name: string, content: string): string {
    const path = join(tmpDir, name);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  afterEach(() => {
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  function createTempDir(): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'config-loader-test-'));
    return tmpDir;
  }

  describe('loadConfigFile', () => {
    it('loads JSON config file', async () => {
      const dir = createTempDir();
      const path = writeTempFile('config.json', JSON.stringify({ name: 'test', maxTurns: 10 }));
      const result = await loadConfigFile(path);
      expect(result).toEqual({ name: 'test', maxTurns: 10 });
    });

    it('loads YAML config file', async () => {
      const dir = createTempDir();
      const path = writeTempFile('config.yaml', 'name: test-yaml\nmaxTurns: 20');
      const result = await loadConfigFile(path);
      expect(result).toEqual({ name: 'test-yaml', maxTurns: 20 });
    });

    it('loads JSON file with leading whitespace', async () => {
      const dir = createTempDir();
      const path = writeTempFile('config.json', '\n\n  {"name": "trimmed", "maxTurns": 5}');
      const result = await loadConfigFile(path);
      expect(result).toEqual({ name: 'trimmed', maxTurns: 5 });
    });

    it('detects JSON from first non-whitespace char', async () => {
      const dir = createTempDir();
      const path = writeTempFile('config.yaml', '{"name": "disguised", "maxTurns": 15}');
      const result = await loadConfigFile(path);
      expect(result).toEqual({ name: 'disguised', maxTurns: 15 });
    });
  });

  describe('loadConfigFileSync', () => {
    it('loads JSON config file synchronously', () => {
      const dir = createTempDir();
      const path = writeTempFile('config.json', JSON.stringify({ name: 'sync-json', maxTurns: 5 }));
      const result = loadConfigFileSync(path);
      expect(result).toEqual({ name: 'sync-json', maxTurns: 5 });
    });

    it('loads YAML config file synchronously', () => {
      const dir = createTempDir();
      const path = writeTempFile('config.yaml', 'name: sync-yaml\nmaxTurns: 8');
      const result = loadConfigFileSync(path);
      expect(result).toEqual({ name: 'sync-yaml', maxTurns: 8 });
    });

    it('loads JSON file with leading whitespace synchronously', () => {
      const dir = createTempDir();
      const path = writeTempFile('config.json', '  \t  {"name": "sync-trimmed", "maxTurns": 3}');
      const result = loadConfigFileSync(path);
      expect(result).toEqual({ name: 'sync-trimmed', maxTurns: 3 });
    });
  });

  describe('resolveConfigPaths', () => {
    it('filters to only existing files', () => {
      const dir = createTempDir();
      const existing = writeTempFile('real.json', '{}');
      const missing = join(dir, 'missing.json');
      const result = resolveConfigPaths([existing, missing]);
      expect(result).toEqual([existing]);
    });

    it('returns empty array for all non-existing', () => {
      const result = resolveConfigPaths(['/tmp/nonexistent-1.json', '/tmp/nonexistent-2.yaml']);
      expect(result).toEqual([]);
    });

    it('handles empty candidates', () => {
      const result = resolveConfigPaths([]);
      expect(result).toEqual([]);
    });
  });
});

// ─── config-merger ──────────────────────────────────────────────

describe('mergeFileConfig', () => {
  const base: AgentConfig = {};

  it('merges name', () => {
    const result = mergeFileConfig(base, { name: 'MyAgent' });
    expect(result.name).toBe('MyAgent');
  });

  it('merges numeric fields', () => {
    const result = mergeFileConfig(base, { maxTurns: 42 });
    expect(result.maxTurns).toBe(42);
  });

  it('merges workspaceRoot', () => {
    const result = mergeFileConfig(base, { workspaceRoot: '/my-workspace' });
    expect(result.workspaceRoot).toBe('/my-workspace');
  });

  it('merges readOnly and autoApproveDangerous', () => {
    const result = mergeFileConfig(base, { readOnly: true, autoApproveDangerous: true });
    expect(result.readOnly).toBe(true);
    expect(result.autoApproveDangerous).toBe(true);
  });

  it('merges toolPolicy', () => {
    const result = mergeFileConfig(base, {
      toolPolicy: { profile: 'minimal' },
    });
    expect(result.toolPolicy).toEqual({ profile: 'minimal' });
  });

  it('merges toolPolicy with existing', () => {
    const existing: AgentConfig = { toolPolicy: { allow: ['read'] } };
    const result = mergeFileConfig(existing, {
      toolPolicy: { deny: ['write'] },
    });
    expect(result.toolPolicy).toEqual({ allow: ['read'], deny: ['write'] });
  });

  it('merges models', () => {
    const result = mergeFileConfig(base, {
      models: { a: { provider: 'openai', model: 'gpt-4' } },
    });
    expect(result.models).toEqual({ a: { provider: 'openai', model: 'gpt-4' } });
  });

  it('merges models with existing', () => {
    const existing: AgentConfig = {
      models: { a: { provider: 'openai', model: 'gpt-4' } },
    };
    const result = mergeFileConfig(existing, {
      models: { b: { provider: 'anthropic', model: 'claude-3' } },
    });
    expect(result.models).toEqual({
      a: { provider: 'openai', model: 'gpt-4' },
      b: { provider: 'anthropic', model: 'claude-3' },
    });
  });

  it('merges single model', () => {
    const result = mergeFileConfig(base, {
      model: { provider: 'openai', model: 'gpt-4' },
    });
    expect(result.model).toEqual({ provider: 'openai', model: 'gpt-4' });
  });

  it('merges activeModel', () => {
    const result = mergeFileConfig(base, { activeModel: 'premium' });
    expect(result.activeModel).toBe('premium');
  });

  it('merges agents', () => {
    const result = mergeFileConfig(base, {
      agents: { a: { name: 'Helper', corePrompt: 'help' } },
    });
    expect(result.agents).toEqual({ a: { name: 'Helper', corePrompt: 'help' } });
  });

  it('merges teams', () => {
    const result = mergeFileConfig(base, {
      teams: { t1: { organizer: 'org', members: ['a', 'b'] } },
    });
    expect(result.teams).toEqual({ t1: { organizer: 'org', members: ['a', 'b'] } });
  });

  it('merges orchestration', () => {
    const result = mergeFileConfig(base, {
      orchestration: { maxAgentRuns: 10 },
    });
    expect(result.orchestration).toEqual({ maxAgentRuns: 10 });
  });

  it('merges orchestration with existing', () => {
    const existing: AgentConfig = { orchestration: { maxDepth: 5 } };
    const result = mergeFileConfig(existing, {
      orchestration: { maxAgentRuns: 10 },
    });
    expect(result.orchestration).toEqual({ maxDepth: 5, maxAgentRuns: 10 });
  });

  it('merges compression', () => {
    const result = mergeFileConfig(base, {
      compression: { enabled: false },
    });
    expect(result.compression).toEqual({ enabled: false });
  });

  it('merges compression with existing', () => {
    const existing: AgentConfig = {
      compression: { enabled: true, thresholdRatio: 0.5 },
    };
    const result = mergeFileConfig(existing, {
      compression: { protectHead: 10 },
    });
    expect(result.compression).toEqual({
      enabled: true, thresholdRatio: 0.5, protectHead: 10,
    });
  });

  it('does not modify base when nothing to merge', () => {
    const result = mergeFileConfig({ name: 'original' }, {});
    expect(result.name).toBe('original');
  });

  it('does not set non-string name', () => {
    const result = mergeFileConfig(base, { name: 42 });
    expect(result.name).toBeUndefined();
  });
});

describe('mergeEnvConfig', () => {
  const base: AgentConfig = {};

  it('merges REM_AGENT_NAME', () => {
    const result = mergeEnvConfig(base, { REM_AGENT_NAME: 'env-agent' } as NodeJS.ProcessEnv);
    expect(result.name).toBe('env-agent');
  });

  it('merges REM_AGENT_MAX_TURNS', () => {
    const result = mergeEnvConfig(base, { REM_AGENT_MAX_TURNS: '100' } as NodeJS.ProcessEnv);
    expect(result.maxTurns).toBe(100);
  });

  it('merges REM_AGENT_WORKSPACE_ROOT', () => {
    const result = mergeEnvConfig(base, { REM_AGENT_WORKSPACE_ROOT: '/ws' } as NodeJS.ProcessEnv);
    expect(result.workspaceRoot).toBe('/ws');
  });

  it('merges REM_AGENT_READ_ONLY', () => {
    const result = mergeEnvConfig(base, { REM_AGENT_READ_ONLY: 'true' } as NodeJS.ProcessEnv);
    expect(result.readOnly).toBe(true);
  });

  it('merges REM_AGENT_AUTO_APPROVE_DANGEROUS', () => {
    const result = mergeEnvConfig(base, { REM_AGENT_AUTO_APPROVE_DANGEROUS: 'true' } as NodeJS.ProcessEnv);
    expect(result.autoApproveDangerous).toBe(true);
    const result2 = mergeEnvConfig(base, { REM_AGENT_AUTO_APPROVE_DANGEROUS: 'false' } as NodeJS.ProcessEnv);
    expect(result2.autoApproveDangerous).toBe(false);
  });

  it('merges REM_AGENT_ACTIVE_MODEL', () => {
    const result = mergeEnvConfig(base, { REM_AGENT_ACTIVE_MODEL: 'production' } as NodeJS.ProcessEnv);
    expect(result.activeModel).toBe('production');
  });

  it('merges compression env vars', () => {
    const env: Partial<NodeJS.ProcessEnv> = {
      REM_COMPRESSION_ENABLED: 'false',
      REM_COMPRESSION_THRESHOLD_RATIO: '0.6',
      REM_COMPRESSION_PROTECT_HEAD: '10',
      REM_COMPRESSION_PROTECT_TAIL: '30',
    };
    const result = mergeEnvConfig(base, env as NodeJS.ProcessEnv);
    expect(result.compression).toEqual({
      enabled: false, thresholdRatio: 0.6, protectHead: 10, protectTail: 30,
    });
  });

  it('compression env merges with existing compression', () => {
    const existing: AgentConfig = {
      compression: { enabled: true, thresholdRatio: 0.8, protectHead: 5 },
    };
    const result = mergeEnvConfig(existing, {
      REM_COMPRESSION_THRESHOLD_RATIO: '0.3',
    } as NodeJS.ProcessEnv);
    expect(result.compression).toMatchObject({
      enabled: true, thresholdRatio: 0.3, protectHead: 5,
    });
  });

  it('keeps unchanged when env vars missing', () => {
    const result = mergeEnvConfig({ name: 'original' }, {} as NodeJS.ProcessEnv);
    expect(result.name).toBe('original');
  });
});

describe('applyBehaviorDefaults', () => {
  it('applies default name', () => {
    const result = applyBehaviorDefaults({});
    expect(result.name).toBe('Rem Agent');
  });

  it('applies default maxTurns', () => {
    const result = applyBehaviorDefaults({});
    expect(result.maxTurns).toBe(60);
  });

  it('applies default workspaceRoot', () => {
    const result = applyBehaviorDefaults({});
    expect(result.workspaceRoot).toBe(process.cwd());
  });

  it('applies default readOnly', () => {
    const result = applyBehaviorDefaults({});
    expect(result.readOnly).toBe(false);
  });

  it('applies default autoApproveDangerous', () => {
    const result = applyBehaviorDefaults({});
    expect(result.autoApproveDangerous).toBe(false);
  });

  it('applies default compression values', () => {
    const result = applyBehaviorDefaults({});
    expect(result.compression).toEqual({
      enabled: true, thresholdRatio: 0.8, protectHead: 3, protectTail: 20,
    });
  });

  it('applies default compression when config empty', () => {
    const result = applyBehaviorDefaults({ compression: {} });
    expect(result.compression).toEqual({
      enabled: true, thresholdRatio: 0.8, protectHead: 3, protectTail: 20,
    });
  });

  it('uses configured values when present', () => {
    const result = applyBehaviorDefaults({
      name: 'CustomAgent', maxTurns: 30, workspaceRoot: '/custom',
      readOnly: true, autoApproveDangerous: true,
      compression: { enabled: false, protectHead: 10 },
    });
    expect(result.name).toBe('CustomAgent');
    expect(result.maxTurns).toBe(30);
    expect(result.workspaceRoot).toBe('/custom');
    expect(result.readOnly).toBe(true);
    expect(result.autoApproveDangerous).toBe(true);
    expect(result.compression).toEqual({
      enabled: false, thresholdRatio: 0.8, protectHead: 10, protectTail: 20,
    });
  });
});

describe('mergeDeepConfig', () => {
  it('delegates to mergeFileConfig for simple fields', () => {
    const base: AgentConfig = {};
    const result = mergeDeepConfig(base, { name: 'deep', maxTurns: 5 });
    expect(result.name).toBe('deep');
    expect(result.maxTurns).toBe(5);
  });

  it('deep merges toolPolicy', () => {
    const base: AgentConfig = {
      toolPolicy: { allow: ['read'], byProvider: { openai: { allow: ['read'] } } },
    };
    const result = mergeDeepConfig(base, {
      toolPolicy: { deny: ['write'], byProvider: { anthropic: { allow: ['read'] } } },
    });
    expect(result.toolPolicy?.allow).toEqual(['read']);
    expect(result.toolPolicy?.deny).toEqual(['write']);
    expect(result.toolPolicy?.byProvider).toEqual({
      openai: { allow: ['read'] },
      anthropic: { allow: ['read'] },
    });
  });

  it('deep merges agents', () => {
    const base: AgentConfig = {
      agents: { a: { name: 'A', corePrompt: 'do a' } },
    };
    const result = mergeDeepConfig(base, {
      agents: { b: { name: 'B', corePrompt: 'do b' } },
    });
    expect(result.agents).toEqual({
      a: { name: 'A', corePrompt: 'do a' },
      b: { name: 'B', corePrompt: 'do b' },
    });
  });

  it('deep merges teams', () => {
    const base: AgentConfig = {
      teams: { t1: { organizer: 'org', members: ['a'] } },
    };
    const result = mergeDeepConfig(base, {
      teams: { t2: { organizer: 'org2', members: ['b'] } },
    });
    expect(result.teams).toEqual({
      t1: { organizer: 'org', members: ['a'] },
      t2: { organizer: 'org2', members: ['b'] },
    });
  });

  it('deep merges orchestration', () => {
    const base: AgentConfig = { orchestration: { maxDepth: 5 } };
    const result = mergeDeepConfig(base, {
      orchestration: { maxAgentRuns: 10 },
    });
    expect(result.orchestration).toEqual({ maxDepth: 5, maxAgentRuns: 10 });
  });

  it('handles missing base fields for deep merge', () => {
    const base: AgentConfig = {};
    const result = mergeDeepConfig(base, {
      toolPolicy: { allow: ['read'] },
      agents: { a: { name: 'A', corePrompt: 'do a' } },
      teams: { t1: { organizer: 'org', members: ['a'] } },
      orchestration: { maxDepth: 5 },
    });
    expect(result.toolPolicy).toEqual({ allow: ['read'] });
    expect(result.agents).toEqual({ a: { name: 'A', corePrompt: 'do a' } });
    expect(result.teams).toEqual({ t1: { organizer: 'org', members: ['a'] } });
    expect(result.orchestration).toEqual({ maxDepth: 5 });
  });

  it('deep merges sandbox in toolPolicy', () => {
    const base: AgentConfig = {
      toolPolicy: {
        sandbox: { mode: 'non-main' as const, tools: { allow: ['read'] } },
      },
    };
    const result = mergeDeepConfig(base, {
      toolPolicy: {
        sandbox: { mode: 'all' as const, tools: { deny: ['write'] } },
      },
    });
    expect(result.toolPolicy?.sandbox).toEqual({
      mode: 'all', tools: { allow: ['read'], deny: ['write'] },
    });
  });

  it('deep merges toolsBySender in toolPolicy', () => {
    const base: AgentConfig = {
      toolPolicy: {
        toolsBySender: { root: { allow: ['read'] } },
      },
    };
    const result = mergeDeepConfig(base, {
      toolPolicy: {
        toolsBySender: { sub: { deny: ['dangerous'] } },
      },
    });
    expect(result.toolPolicy?.toolsBySender).toEqual({
      root: { allow: ['read'] },
      sub: { deny: ['dangerous'] },
    });
  });
});

// ─── default-config-provider ────────────────────────────────────

const paths = createDefaultAgentPaths({
  agentDir: '/tmp/rem-agent-test-nonexistent',
  homeAgentDir: '/tmp/rem-agent-test-nonexistent-home',
  env: {},
});

describe('DefaultConfigProvider additional coverage', () => {
  it('getToolConfig returns policy from config', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const toolCfg = provider.getToolConfig();
    expect(toolCfg).toHaveProperty('policy');
  });

  it('getCompressionConfig returns defaults', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const comp = provider.getCompressionConfig();
    expect(comp.enabled).toBe(true);
    expect(comp.thresholdRatio).toBe(0.8);
  });

  it('getCompressionConfig with custom compression values', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-compression-test-'));
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      compression: { enabled: false, thresholdRatio: 0.5, protectHead: 10 },
    }), 'utf8');
    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths: customPaths });
      const comp = provider.getCompressionConfig();
      expect(comp.enabled).toBe(false);
      expect(comp.thresholdRatio).toBe(0.5);
      expect(comp.protectHead).toBe(10);
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('resolveAgent throws before init', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.resolveAgent()).toThrow('must be initialized');
  });

  it('resolveTeam throws before init', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.resolveTeam('any')).toThrow('must be initialized');
  });

  it('resolveTeam throws for unknown team after init', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    expect(() => provider.resolveTeam('unknown')).toThrow('Unknown team');
  });

  it('getModelConfig with specific modelId returns resolved model', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const model = provider.getModelConfig();
    expect(model.provider).toBe('openai');
    expect(model.model).toBe('');
  });

  it('getModelConfig with explicit modelId from models', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-model-test-'));
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      activeModel: 'premium',
      models: {
        default: { provider: 'google', model: 'gemini' },
        premium: { provider: 'anthropic', model: 'claude-3' },
      },
    }), 'utf8');
    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths: customPaths });
      const model = provider.getModelConfig('premium');
      expect(model.provider).toBe('anthropic');
      expect(model.model).toBe('claude-3');
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('getConfig returns structured config', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const config = provider.getConfig();
    expect(config.name).toBe('Rem Agent');
    expect(config.maxTurns).toBe(60);
    expect(config.model).toBeDefined();
    expect(config.model.provider).toBe('openai');
  });

  it('getBehaviorConfig throws when no paths', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.getBehaviorConfig()).toThrow('must be initialized');
  });

  it('forWorkspace with no workspace config file uses home config', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    const scoped = provider.forWorkspace('/tmp/nonexistent-workspace');
    const config = scoped.getConfig();
    expect(config.name).toBeDefined();
  });

  it('getModelConfig throws when not initialized without paths', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.getModelConfig()).toThrow('must be initialized');
  });

  it('getToolConfig throws when not initialized without paths', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.getToolConfig()).toThrow('must be initialized');
  });

  it('resolveAgent resolves custom agent with model via resolveModel callback', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-model-test-'));
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      agents: {
        custom: {
          name: 'CustomAgent',
          corePrompt: 'Test prompt',
          model: { provider: 'openai', model: 'gpt-4-turbo' },
        },
      },
    }), 'utf8');
    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths: customPaths });
      const role = provider.resolveAgent('custom');
      expect(role.name).toBe('CustomAgent');
      expect(role.corePrompt).toBe('Test prompt');
      expect(role.model).toBeDefined();
      expect(role.model?.provider).toBe('openai');
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('resolveModel callback returns undefined for model with missing provider', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-empty-model-test-'));
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      agents: {
        bad: {
          name: 'BadAgent',
          corePrompt: 'Test',
          model: { provider: '', model: 'gpt-4' },
        },
      },
    }), 'utf8');
    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths: customPaths });
      const role = provider.resolveAgent('bad');
      expect(role.name).toBe('BadAgent');
      expect(role.model).toBeUndefined();
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('resolveModel callback returns undefined for model with missing model name', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-agent-no-model-test-'));
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      agents: {
        partial: {
          name: 'PartialAgent',
          corePrompt: 'Test',
          model: { provider: 'openai' },
        },
      },
    }), 'utf8');
    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths: customPaths });
      const role = provider.resolveAgent('partial');
      expect(role.model).toBeUndefined();
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('getOrchestrationConfig throws when not initialized without paths', () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    expect(() => provider.getOrchestrationConfig()).toThrow('must be initialized');
  });

  it('init() re-enters loadSync when paths are provided in constructor', async () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths });
    (provider as any).raw = undefined;
    (provider as any).rawHome = undefined;
    await provider.init();
    const config = provider.getConfig();
    expect(config.name).toBe('Rem Agent');
  });

  it('forWorkspace merges workspace config file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-workspace-config-test-'));
    const homeConfigPath = join(tempDir, 'config.json');
    writeFileSync(homeConfigPath, JSON.stringify({
      name: 'HomeAgent',
      maxTurns: 10,
    }), 'utf8');

    const workspaceDir = mkdtempSync(join(tmpdir(), 'rem-workspace-test-'));
    const workspaceConfigPath = join(workspaceDir, 'rem-agent.config.json');
    writeFileSync(workspaceConfigPath, JSON.stringify({
      name: 'WorkspaceAgent',
      maxTurns: 5,
    }), 'utf8');

    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv, paths: customPaths });
      const scoped = provider.forWorkspace(workspaceDir);
      const config = scoped.getConfig();
      expect(config.name).toBe('WorkspaceAgent');
      expect(config.maxTurns).toBe(5);
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      try { rmSync(workspaceDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('init() without constructor paths and without override works', async () => {
    const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
    await provider.init();
    const config = provider.getConfig();
    expect(config.name).toBe('Rem Agent');
  });

  it('init() without constructor paths loads existing home config file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'rem-init-home-config-test-'));
    const configPath = join(tempDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      name: 'HomeInitAgent',
      maxTurns: 42,
    }), 'utf8');
    try {
      const customPaths = createDefaultAgentPaths({
        agentDir: tempDir,
        homeAgentDir: tempDir,
        env: {},
      });
      const provider = new DefaultConfigProvider({ env: {} as NodeJS.ProcessEnv });
      (provider as any).resolvePaths = function(this: typeof provider) {
        (this as any)._paths = customPaths;
        return Promise.resolve(customPaths);
      };
      await provider.init();
      const config = provider.getConfig();
      expect(config.name).toBe('HomeInitAgent');
      expect(config.maxTurns).toBe(42);
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
});
