import path from 'node:path';
import { AgentService } from 'rem-agent-bridge';
import { createDefaultAgentPaths, SqliteStorageProvider } from 'rem-agent-core';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<AgentService> {
  const paths = createDefaultAgentPaths();
  const storageProvider = new SqliteStorageProvider({
    dbPath: path.join(paths.agentDir, 'rem-agent.db'),
  });
  await storageProvider.init();

  const service = new AgentService({ workspaceRoot: process.cwd(), storageProvider });
  await service.init();
  return service;
}

export function getAgentService(): Promise<AgentService> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createService();
  }
  return g[GLOBAL_KEY] as Promise<AgentService>;
}
