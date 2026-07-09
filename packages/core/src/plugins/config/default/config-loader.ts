import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ConfigFileData } from './index.js';
import { resolveTilde } from '../../../config/paths.js';
import type { AgentPaths } from '../../../config/paths.js';

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
  paths: AgentPaths,
): string | undefined {
  if (explicitPath) return resolveTilde(explicitPath);
  const candidates = paths.configCandidates(cwd);
  return resolveConfigPaths(candidates)[0];
}

export function resolveConfigPaths(candidates: string[]): string[] {
  return candidates.filter((candidate) => existsSync(candidate));
}
