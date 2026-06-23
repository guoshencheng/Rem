import { getDefaultSessionsDir } from 'rem-agent-core';
import { join } from 'path';

export interface DemoConfig {
  agentName: string;
  maxTurns: number;
  sessionDir: string;
  sessionId?: string;
  port: number;
  host: string;
}

function parseArgs(): { sessionId?: string } {
  const args = process.argv.slice(2);
  const sessionIndex = args.indexOf('--session');
  if (sessionIndex !== -1 && sessionIndex + 1 < args.length) {
    return { sessionId: args[sessionIndex + 1] };
  }
  return {};
}

function resolveSessionDir(): string {
  const envDir = process.env.DEMO_SESSION_DIR;
  if (envDir) {
    return envDir.replace(/^~/, process.env.HOME ?? '/');
  }
  return getDefaultSessionsDir();
}

export function resolveConfig(): DemoConfig {
  const agentName = process.env.DEMO_AGENT_NAME ?? 'Core Demo Agent';
  const maxTurns = parseInt(process.env.DEMO_MAX_TURNS ?? '60', 10);
  const sessionDir = resolveSessionDir();
  const args = parseArgs();
  const port = parseInt(process.env.DEMO_PORT ?? '8321', 10);
  const host = process.env.DEMO_HOST ?? 'localhost';

  return {
    agentName,
    maxTurns,
    sessionDir,
    sessionId: args.sessionId,
    port,
    host,
  };
}
