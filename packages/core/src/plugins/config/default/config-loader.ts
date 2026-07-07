import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ConfigFileData } from './index.js';
import { resolveTilde, getRemAgentDir } from '../../../config/paths.js';

export async function loadConfigFile(path: string): Promise<ConfigFileData> {
  const resolved = resolveTilde(path);
  const content = await readFile(resolved, 'utf8');
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(content) as ConfigFileData;
  }
  const { parse } = await import('yaml');
  return parse(content) as ConfigFileData;
}

export function resolveConfigPath(
  explicitPath: string | undefined,
  cwd: string,
): string | undefined {
  if (explicitPath) return resolveTilde(explicitPath);
  const candidates = [
    join(cwd, 'rem-agent.config.json'),
    join(cwd, 'rem-agent.config.yaml'),
    join(cwd, 'rem-agent.config.yml'),
    join(getRemAgentDir(), 'config.json'),
    join(getRemAgentDir(), 'config.yaml'),
    join(getRemAgentDir(), 'config.yml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
