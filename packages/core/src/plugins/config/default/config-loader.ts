import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { ConfigFileData } from './index.js';
import { resolveTilde } from '../../../config/paths.js';

export async function loadConfigFile(path: string): Promise<ConfigFileData> {
  const resolved = resolveTilde(path);
  const content = await readFile(resolved, 'utf8');
  return parseConfigContent(content);
}

export function loadConfigFileSync(path: string): ConfigFileData {
  const resolved = resolveTilde(path);
  const content = readFileSync(resolved, 'utf8');
  return parseConfigContent(content);
}

export function resolveConfigPaths(candidates: string[]): string[] {
  return candidates.filter((candidate) => existsSync(candidate));
}

function parseConfigContent(content: string): ConfigFileData {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(content) as ConfigFileData;
  }
  return parseYaml(content) as ConfigFileData;
}
