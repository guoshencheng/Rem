import { createContainer, asFunction, asValue, Lifetime, type AwilixContainer } from 'awilix';
import { createProviderManager, LocalSessionProvider } from 'rem-agent-core';
import { AgentService, SessionService } from 'rem-agent-bridge';
import { resolve } from 'path';

async function configureContainer(): Promise<AwilixContainer> {
  const sessionsDir = resolve(process.cwd(), '.sessions');
  const pm = await createProviderManager({
    sessionProvider: new LocalSessionProvider(sessionsDir),
  });
  const container = createContainer();

  container.register({
    providerManager: asValue(pm),
    agentService: asFunction(({ providerManager }) => new AgentService(providerManager), {
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
