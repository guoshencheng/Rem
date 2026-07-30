import { createAgentFromEnv, createDefaultAgentPaths } from 'rem-agent-core';
import { AgentService } from 'rem-agent-bridge';
import type { IAgentService } from 'rem-agent-bridge';
import { AgentsUniService } from 'rem-agent-bridge-v2';

const GLOBAL_KEY = '__REM_AGENT_SERVICE__';

async function createService(): Promise<IAgentService> {
  const paths = createDefaultAgentPaths();
  const { di, runtimeConfig } = await createAgentFromEnv({ paths });
  if (process.env.REM_IMPL === 'v2') {
    return new AgentsUniService(di, runtimeConfig);
  }
  return new AgentService(di, runtimeConfig);
}

export function getAgentService(): Promise<IAgentService> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createService();
  }
  return g[GLOBAL_KEY] as Promise<IAgentService>;
}
