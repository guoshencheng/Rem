import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DefaultRuntimeConfigProvider } from '../src/plugins/config/default/default-runtime-config-provider.js';
import { createDefaultAgentPaths } from '../src/infrastructure/config/paths.js';

async function providerWith(config: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-config-'));
  await writeFile(join(dir, 'config.json'), JSON.stringify(config));
  const paths = createDefaultAgentPaths({ agentDir: dir, homeAgentDir: dir, env });
  const provider = new DefaultRuntimeConfigProvider({ paths, env });
  await provider.init();
  return provider;
}

describe('DefaultRuntimeConfigProvider', () => {
  it('uses provider environment fallback when apiKey is omitted', async () => {
    const provider = await providerWith({ model: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, { DEEPSEEK_API_KEY: 'secret' });
    expect(provider.resolveModel('default')).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'secret' });
  });

  it('resolves ${VAR} but leaves legacy braces and missing variables visible', async () => {
    const template = await providerWith({ model: { provider: 'deepseek', model: 'm', apiKey: '${DEEPSEEK_API_KEY}' } }, { DEEPSEEK_API_KEY: 'secret' });
    expect(template.resolveModel('default').apiKey).toBe('secret');
    const legacy = await providerWith({ model: { provider: 'deepseek', model: 'm', apiKey: '{DEEPSEEK_API_KEY}' } }, { DEEPSEEK_API_KEY: 'secret' });
    expect(legacy.resolveModel('default').apiKey).toBe('{DEEPSEEK_API_KEY}');
    const missing = await providerWith({ model: { provider: 'deepseek', model: 'm', apiKey: '${MISSING_API_KEY}' } });
    expect(missing.resolveModel('default').apiKey).toBe('${MISSING_API_KEY}');
  });

  it('exposes only runtime defaults and freezes the configured execution root', async () => {
    const provider = await providerWith({ executionRoot: '/opt/runtime', maxTurns: 7, readOnly: true });
    expect(provider.getDefaults()).toMatchObject({ behavior: { executionRoot: '/opt/runtime', maxTurns: 7, readOnly: true } });
    expect('resolveAgent' in provider).toBe(false);
    expect('resolveTeam' in provider).toBe(false);
  });
});
