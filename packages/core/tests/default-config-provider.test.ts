import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentPaths } from '../src/config/paths.js';
import { DefaultConfigProvider } from '../src/plugins/config/default/index.js';
import { createDefaultAgentPaths } from '../src/config/paths.js';

describe('DefaultConfigProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `rem-config-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makePaths(): AgentPaths {
    const base = createDefaultAgentPaths({ agentDir: tempDir });
    return {
      ...base,
      homeConfigCandidates: () => [
        join(tempDir, 'home-config.json'),
        join(tempDir, 'home-config.yaml'),
        join(tempDir, 'home-config.yml'),
      ],
    };
  }

  it('applies defaults when nothing is provided', async () => {
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    const behavior = provider.getBehaviorConfig();
    const model = provider.getModelConfig();
    expect(behavior.name).toBe('Rem Agent');
    expect(model.provider).toBe('openai');
    expect(behavior.maxTurns).toBe(60);
    expect(behavior.readOnly).toBe(false);
  });

  it('reads from JSON config file', async () => {
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({ name: 'File Agent', maxTurns: 30, readOnly: true }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('File Agent');
    expect(provider.getBehaviorConfig().maxTurns).toBe(30);
    expect(provider.getBehaviorConfig().readOnly).toBe(true);
  });

  it('env overrides file', async () => {
    await writeFile(join(tempDir, 'rem-agent.config.json'), JSON.stringify({ name: 'File Agent' }));
    const paths = makePaths();
    const provider = new DefaultConfigProvider({
      paths,
      cwd: tempDir,
      env: { REM_AGENT_NAME: 'Env Agent' },
    });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Env Agent');
  });

  it('inline overrides beat env', async () => {
    const paths = makePaths();
    const provider = new DefaultConfigProvider({
      paths,
      cwd: tempDir,
      env: { REM_AGENT_NAME: 'Env Agent' },
      overrides: { name: 'Inline Agent' },
    });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Inline Agent');
  });

  it('parses toolPolicy from file', async () => {
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({ toolPolicy: { profile: 'coding', allow: ['read'] } }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getToolConfig().policy).toEqual({ profile: 'coding', allow: ['read'] });
  });

  it('parses mcpServers from JSON config and resolves env vars', async () => {
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({
        mcpServers: {
          fs: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: { KEY: '${MCP_KEY}' },
          },
          remote: { transport: 'sse', url: 'http://localhost:3001/sse', prefix: 'remote' },
        },
      }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({
      paths,
      cwd: tempDir,
      env: { MCP_KEY: 'secret' },
    });
    await provider.init();

    const mcp = provider.getMcpConfig();
    expect(mcp.fs.transport).toBe('stdio');
    expect((mcp.fs as any).command).toBe('npx');
    expect((mcp.fs as any).env.KEY).toBe('secret');
    expect(mcp.remote.transport).toBe('sse');
    expect((mcp.remote as any).prefix).toBe('remote');
  });

  it('returns empty mcp config when none provided', async () => {
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getMcpConfig()).toEqual({});
  });

  it('loads home config as base when no workspace config exists', async () => {
    await writeFile(
      join(tempDir, 'home-config.json'),
      JSON.stringify({ name: 'Home Agent', maxTurns: 50 }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Home Agent');
    expect(provider.getBehaviorConfig().maxTurns).toBe(50);
  });

  it('workspace config overrides home config properties', async () => {
    await writeFile(
      join(tempDir, 'home-config.json'),
      JSON.stringify({ name: 'Home Agent', maxTurns: 50, readOnly: false }),
    );
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({ name: 'Workspace Agent', readOnly: true }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Workspace Agent');
    expect(provider.getBehaviorConfig().maxTurns).toBe(50);
    expect(provider.getBehaviorConfig().readOnly).toBe(true);
  });

  it('merges mcpServers by key, keeping home servers not in workspace', async () => {
    await writeFile(
      join(tempDir, 'home-config.json'),
      JSON.stringify({
        mcpServers: {
          homeServer: { transport: 'stdio', command: 'home-cmd' },
          sharedServer: { transport: 'stdio', command: 'home-shared' },
        },
      }),
    );
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({
        mcpServers: {
          sharedServer: { transport: 'stdio', command: 'workspace-shared' },
          wsServer: { transport: 'sse', url: 'http://ws' },
        },
      }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    const mcp = provider.getMcpConfig();
    expect((mcp.homeServer as any).command).toBe('home-cmd');
    expect((mcp.sharedServer as any).command).toBe('workspace-shared');
    expect((mcp.wsServer as any).url).toBe('http://ws');
  });

  it('merges models by key, keeping home models not in workspace', async () => {
    await writeFile(
      join(tempDir, 'home-config.json'),
      JSON.stringify({
        models: {
          default: { provider: 'openai', model: 'gpt-4' },
          cheap: { provider: 'openai', model: 'gpt-3.5' },
        },
      }),
    );
    await writeFile(
      join(tempDir, 'rem-agent.config.json'),
      JSON.stringify({
        models: {
          cheap: { provider: 'anthropic', model: 'claude-3-haiku' },
          premium: { provider: 'anthropic', model: 'claude-3-opus' },
        },
      }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getModelConfig('default').model).toBe('gpt-4');
    expect(provider.getModelConfig('cheap').model).toBe('claude-3-haiku');
    expect(provider.getModelConfig('premium').model).toBe('claude-3-opus');
  });

  it('does not overwrite file config with undefined overrides', async () => {
    await writeFile(
      join(tempDir, 'home-config.json'),
      JSON.stringify({ name: 'Home Agent', maxTurns: 30 }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({
      paths,
      cwd: tempDir,
      env: {},
      overrides: { name: undefined, maxTurns: 100 },
    });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Home Agent');
    expect(provider.getBehaviorConfig().maxTurns).toBe(100);
  });

  it('workspace config in .rem-agent subdirectory is found and merged', async () => {
    await writeFile(
      join(tempDir, 'home-config.json'),
      JSON.stringify({ name: 'Home Agent' }),
    );
    const subDir = join(tempDir, '.rem-agent');
    await mkdir(subDir, { recursive: true });
    await writeFile(
      join(subDir, 'config.json'),
      JSON.stringify({ name: 'Subdir Agent' }),
    );
    const paths = makePaths();
    const provider = new DefaultConfigProvider({ paths, cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Subdir Agent');
  });
});
