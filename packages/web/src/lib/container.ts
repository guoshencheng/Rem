import { createContainer, asClass, asValue, Lifetime, type AwilixContainer } from 'awilix';
import { createProviderManager } from 'rem-agent-core';
import { AgentService, SessionService } from 'rem-agent-bridge';

async function configureContainer(): Promise<AwilixContainer> {
  const pm = await createProviderManager();
  const container = createContainer();

  container.register({
    providerManager: asValue(pm),
    agentService: asClass(AgentService, { lifetime: Lifetime.SINGLETON }),
    sessionService: asClass(SessionService, { lifetime: Lifetime.SINGLETON }),
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
