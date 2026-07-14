import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService, SqliteWorkspaceRepository } from 'rem-agent-bridge';
import { createDefaultAgentPaths, log } from 'rem-agent-core';

const GLOBAL_CONTAINER_KEY = '__REM_AGENT_CONTAINER__';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const service = new AgentService({ workspaceRoot: process.cwd() });
  await service.init();

  const workspaceRepository = new SqliteWorkspaceRepository(
    service.context!.workspaceStore,
  );

  log('config', 'LLM config loaded', {
    model: service.context?.configProvider.getModelConfig().model,
    provider: service.context?.configProvider.getModelConfig().provider,
    hasApiKey: !!service.context?.configProvider.getModelConfig().apiKey,
    baseURL: service.context?.configProvider.getModelConfig().baseURL,
  });

  container.register({
    agentService: asFunction(() => service, {
      lifetime: Lifetime.SINGLETON,
    }),
    workspaceRepository: asFunction(() => workspaceRepository, {
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
    _initPromise = configureContainer()
      .then((c) => {
        globalAny[GLOBAL_CONTAINER_KEY] = c;
        return c;
      })
      .finally(() => {
        _initPromise = null;
      });
  }
  return _initPromise;
}
