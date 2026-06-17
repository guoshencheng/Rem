import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_REM_AGENT_DIR_NAME = '.rem-agent';
const SKILLS_DIR_NAME = 'skills';
const SESSIONS_DIR_NAME = 'sessions';

export function resolveTilde(rawPath: string): string {
  if (rawPath.startsWith('~')) {
    return join(homedir(), rawPath.slice(1));
  }
  return rawPath;
}

export function getRemAgentDir(): string {
  const envDir = process.env.REM_AGENT_HOME || process.env.REM_AGENT_DIR;
  if (envDir) {
    return resolveTilde(envDir);
  }
  return join(homedir(), DEFAULT_REM_AGENT_DIR_NAME);
}

export function getDefaultSkillsDir(): string {
  return join(getRemAgentDir(), SKILLS_DIR_NAME);
}

export function getDefaultSessionsDir(): string {
  return join(getRemAgentDir(), SESSIONS_DIR_NAME);
}
