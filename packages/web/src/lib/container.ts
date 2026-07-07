import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService } from 'rem-agent-bridge';
import { createAgentFromEnv } from 'rem-agent-core';

const GLOBAL_CONTAINER_KEY = '__REM_AGENT_CONTAINER__';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const ctx = await createAgentFromEnv({
    workspaceRoot: process.cwd(),
  });
  console.log('[Container] LLM config:', {
    model: ctx.configProvider.getModelConfig().model,
    provider: ctx.configProvider.getModelConfig().provider,
    hasApiKey: !!ctx.configProvider.getModelConfig().apiKey,
    baseURL: ctx.configProvider.getModelConfig().baseURL,
  });

  container.register({
    agentService: asFunction(() => new AgentService(ctx), {
      lifetime: Lifetime.SINGLETON,
    }),
  });

  return container;
}

let _initPromise: Promise<AwilixContainer> | null = null;

export async function getContainer(): Promise<AwilixContainer> {
  const globalAny = globalThis as any;
  if (globalAny[GLOBAL_CONTAINER_KEY]) {
    return globalAny[GLOBAL_CONTAINER_KEY];
  }

  if (!_initPromise) {
    _initPromise = configureContainer().then((c) => {
      globalAny[GLOBAL_CONTAINER_KEY] = c;
      _initPromise = null;
      return c;
    });
  }
  return _initPromise;
}
