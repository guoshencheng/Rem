import { createContainer, asFunction, Lifetime, type AwilixContainer } from 'awilix';
import { AgentRemoteService, SessionService } from 'rem-agent-bridge';

async function configureContainer(): Promise<AwilixContainer> {
  const container = createContainer();

  container.register({
    agentService: asFunction(() => new AgentRemoteService(''), {
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
