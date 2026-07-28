import { AgentService } from 'rem-agent-bridge';
import { createAgentAssembly, createDefaultAgentPaths } from 'rem-agent-core';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<AgentService> {
  const paths = createDefaultAgentPaths();
  const { di, runtimeConfig } = createAgentAssembly({ paths });
  const service = new AgentService(di, runtimeConfig);
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
