import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService, BridgeAgentStateProvider } from 'rem-agent-bridge';
import { createAgentFromEnv, FileSessionProvider } from 'rem-agent-core';
import { getDefaultSessionsDir } from 'rem-agent-core';

const GLOBAL_CONTAINER_KEY = '__REM_AGENT_CONTAINER__';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const sessionsDir = process.env.REM_AGENT_SESSIONS_DIR ?? getDefaultSessionsDir();
  const sessionProvider = new FileSessionProvider(sessionsDir);
  const { pm } = await createAgentFromEnv({
    sessionProvider,
    agentStateProvider: new BridgeAgentStateProvider(),
  });
  console.log('[Container] LLM config:', { model: pm.getModelConfig().model, provider: pm.provider, hasApiKey: !!pm.providerConfig.apiKey, baseURL: pm.providerConfig.baseURL });

  container.register({
    agentService: asFunction(() => new AgentService(pm), {
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
