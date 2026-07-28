import { AgentService } from 'rem-agent-bridge';
import { createAgentFromEnv, createDefaultAgentPaths } from 'rem-agent-core';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<AgentService> {
  const paths = createDefaultAgentPaths();
  const { di, runtimeConfig } = await createAgentFromEnv({ paths });
  return new AgentService(di, runtimeConfig);
}

export function getAgentService(): Promise<AgentService> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createService();
  }
  return g[GLOBAL_KEY] as Promise<AgentService>;
}
