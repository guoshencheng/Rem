import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DefaultConfigProvider } from '../src/plugins/config/default/index.js';

describe('DefaultConfigProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `rem-config-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('applies defaults when nothing is provided', async () => {
    const provider = new DefaultConfigProvider({ cwd: tempDir, env: {} });
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
    const provider = new DefaultConfigProvider({ cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('File Agent');
    expect(provider.getBehaviorConfig().maxTurns).toBe(30);
    expect(provider.getBehaviorConfig().readOnly).toBe(true);
  });

  it('env overrides file', async () => {
    await writeFile(join(tempDir, 'rem-agent.config.json'), JSON.stringify({ name: 'File Agent' }));
    const provider = new DefaultConfigProvider({
      cwd: tempDir,
      env: { REM_AGENT_NAME: 'Env Agent' },
    });
    await provider.init();
    expect(provider.getBehaviorConfig().name).toBe('Env Agent');
  });

  it('inline overrides beat env', async () => {
    const provider = new DefaultConfigProvider({
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
    const provider = new DefaultConfigProvider({ cwd: tempDir, env: {} });
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
    const provider = new DefaultConfigProvider({
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
    const provider = new DefaultConfigProvider({ cwd: tempDir, env: {} });
    await provider.init();
    expect(provider.getMcpConfig()).toEqual({});
  });
});
