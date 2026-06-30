import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentService, SessionService } from 'rem-agent-bridge';
import { createAgentFromEnv, FileSessionProvider } from 'rem-agent-core';
import { getDefaultSessionsDir } from 'rem-agent-core';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  const sessionsDir = process.env.REM_AGENT_SESSIONS_DIR ?? getDefaultSessionsDir();
  const sessionProvider = new FileSessionProvider(sessionsDir);
  const { pm } = await createAgentFromEnv({ sessionProvider });
  console.log('[Container] LLM config:', { model: pm.getModelConfig().model, provider: pm.provider, hasApiKey: !!pm.providerConfig.apiKey, baseURL: pm.providerConfig.baseURL });

  container.register({
    agentService: asFunction(() => new AgentService(pm), {
      lifetime: Lifetime.SINGLETON,
    }),
    sessionService: asFunction(({ agentService }) => new SessionService(agentService), {
      lifetime: Lifetime.SINGLETON,
    }),
  });

  return container;
}

let _container: AwilixContainer | null = null;
let _initPromise: Promise<AwilixContainer> | null = null;

export async function getContainer(): Promise<AwilixContainer> {
  if (_container) return _container;
  if (!_initPromise) {
    _initPromise = configureContainer().then((c) => {
      _container = c;
      _initPromise = null;
      return c;
    });
  }
  return _initPromise;
}
