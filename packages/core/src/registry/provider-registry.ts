import type {
  ProviderKind,
  ProviderLoader,
  ProviderLoaderContext,
  ProviderReference,
  ProviderRegistry,
} from '../sdk/provider-loader.js';

export interface ProviderRegistryConfig {
  sessionProvider: ProviderReference<unknown>;
  toolProvider: ProviderReference<unknown>;
  memoryProvider: ProviderReference<unknown>;
  contextProvider: ProviderReference<unknown>;
  compressor: ProviderReference<unknown>;
  errorHandler: ProviderReference<unknown>;
  skillProvider: ProviderReference<unknown>;
  budgetPolicy?: ProviderReference<unknown>;
  titleProvider?: ProviderReference<unknown>;
  loopStrategy: ProviderReference<unknown>;
  reasonProvider: ProviderReference<unknown>;
  executeProvider: ProviderReference<unknown>;
  [key: string]: ProviderReference<unknown> | undefined;
}

export interface AgentProviderRegistryOptions {
  loader: ProviderLoader;
  ctx: ProviderLoaderContext;
  refs: Partial<ProviderRegistryConfig>;
}

const KIND_TO_REFS_KEY: Partial<Record<ProviderKind, keyof ProviderRegistryConfig>> = {
  session: 'sessionProvider',
  tool: 'toolProvider',
  memory: 'memoryProvider',
  context: 'contextProvider',
  compressor: 'compressor',
  error: 'errorHandler',
  skill: 'skillProvider',
  budget: 'budgetPolicy',
  title: 'titleProvider',
  loopStrategy: 'loopStrategy',
  reason: 'reasonProvider',
  execute: 'executeProvider',
};

const DEFAULT_NAMES: Partial<Record<ProviderKind, string>> = {
  tool: 'file-system',
  memory: 'simple',
  context: 'simple',
  skill: 'file',
  session: 'in-memory',
  compressor: 'no-op',
  error: 'simple',
  budget: 'fixed',
  config: 'default',
  loopStrategy: 'react',
  turnRunner: 'react',
  title: 'llm',
  reason: 'default',
  execute: 'default',
};

export class AgentProviderRegistry implements ProviderRegistry {
  private loader: ProviderLoader;
  private ctx: ProviderLoaderContext;
  private refs: Partial<ProviderRegistryConfig>;
  private providers = new Map<ProviderKind, unknown>();

  constructor(options: AgentProviderRegistryOptions) {
    this.loader = options.loader;
    this.ctx = options.ctx;
    this.refs = options.refs;
  }

  async initialize(): Promise<void> {
    await this.resolve('session');
    await this.resolve('tool');
    await this.resolve('memory');
    await this.resolve('context');
    await this.resolve('compressor');
    await this.resolve('error');
    await this.resolve('skill');
    await this.resolve('budget');
    await this.resolve('title');
    await this.resolve('loopStrategy');
    await this.resolve('reason');
    await this.resolve('execute');
  }

  has(kind: ProviderKind): boolean {
    return this.providers.has(kind);
  }

  get<T>(kind: ProviderKind): T | undefined {
    if (!this.providers.has(kind)) {
      const defaultName = DEFAULT_NAMES[kind];
      if (defaultName !== undefined) {
        throw new Error(
          `Provider "${kind}" has not been loaded. Use a ProviderReference to configure it or rely on the default "${defaultName}".`,
        );
      }
    }
    return this.providers.get(kind) as T | undefined;
  }

  require<T>(kind: ProviderKind): T {
    const provider = this.get<T>(kind);
    if (provider === undefined) {
      throw new Error(`Provider "${kind}" is not registered`);
    }
    return provider;
  }

  register<T>(kind: ProviderKind, provider: T): void {
    this.providers.set(kind, provider);
  }

  private async resolve(kind: ProviderKind): Promise<void> {
    const refsKey = KIND_TO_REFS_KEY[kind] ?? kind;
    const ref = this.refs[refsKey] ?? DEFAULT_NAMES[kind];
    const provider = await this.loader.load(ref, { ...this.ctx, kind });
    this.providers.set(kind, provider);
  }
}
