import { createProviderManager } from 'rem-agent-core';
import { AgentService, SessionService } from 'rem-agent-bridge';

const g = globalThis as unknown as {
  __agentService?: AgentService;
  __sessionService?: SessionService;
  __initPromise?: Promise<void>;
};

async function init(): Promise<void> {
  const pm = await createProviderManager();
  g.__agentService = new AgentService(pm);
  g.__sessionService = new SessionService(g.__agentService);
}

async function ensure(): Promise<void> {
  if (g.__agentService && g.__sessionService) return;
  if (!g.__initPromise) {
    g.__initPromise = init();
  }
  await g.__initPromise;
}

export async function getAgentService(): Promise<AgentService> {
  await ensure();
  return g.__agentService!;
}

export async function getSessionService(): Promise<SessionService> {
  await ensure();
  return g.__sessionService!;
}
