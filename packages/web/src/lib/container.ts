import { createContainer, asClass, asValue, Lifetime, type AwilixContainer } from 'awilix';
import {
  createProviderManager,
  LocalSessionProvider,
  InMemoryToolProvider,
  SimpleMemoryProvider,
  FileSkillProvider,
  NoOpCompressor,
  SimpleErrorHandler,
  FixedBudgetPolicy,
} from 'rem-agent-core';
import type { ConfigProvider, ResolvedModelConfig } from 'rem-agent-core';
import { AgentService, SessionService } from 'rem-agent-bridge';
import { resolve } from 'path';

async function configureContainer(): Promise<AwilixContainer> {
  const sessionsDir = resolve(process.cwd(), '.sessions');
  const skillsDir = resolve(process.cwd(), '.skills');

  const pm = await createProviderManager({
    configProvider: {
      getConfig: () => ({
        name: 'Rem Agent', maxTurns: 60, workspaceRoot: process.cwd(), readOnly: false,
        sessionsDir, skillsDir,
        toolPolicy: undefined, model: { provider: 'openai', model: '', apiKey: '', baseURL: undefined },
      }),
      getBehaviorConfig: () => ({
        name: 'Rem Agent', maxTurns: 60, workspaceRoot: process.cwd(), readOnly: false,
        sessionsDir, skillsDir,
      }),
      getModelConfig: (): ResolvedModelConfig => ({
        provider: 'openai', model: '', apiKey: '', baseURL: undefined,
      }),
      getToolConfig: () => ({ policy: undefined }),
    } as ConfigProvider,
    sessionProvider: new LocalSessionProvider(sessionsDir),
    toolProvider: new InMemoryToolProvider(),
    memoryProvider: new SimpleMemoryProvider('Rem Agent'),
    skillProvider: new FileSkillProvider({ skillsDir }),
    compressor: new NoOpCompressor(),
    errorHandler: new SimpleErrorHandler(),
    budgetPolicy: new FixedBudgetPolicy({ maxTurns: 60 }),
  });

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
