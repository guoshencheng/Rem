import path from 'node:path';
import { AgentService } from 'rem-agent-bridge';
import { createDefaultAgentPaths } from 'rem-agent-core';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<AgentService> {
  const paths = createDefaultAgentPaths();
  const service = new AgentService({ paths });
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
