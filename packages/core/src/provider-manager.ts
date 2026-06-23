import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { AgentProviderRegistry } from './registry/provider-registry.js';
import { DefaultProviderLoader } from './registry/provider-loader.js';
import { builtinProviderResolver } from './plugins/index.js';
import { registerBuiltInProviders } from './llm/providers/index.js';
import type {
  ProviderReference,
  ProviderRegistry,
} from './sdk/provider-loader.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type {
  ConfigProvider,
  ResolvedModelConfig,
} from './sdk/config-provider.js';
import type { ProviderConfig } from './llm/types.js';
import { getDefaultSkillsDir, getDefaultSessionsDir } from './config/paths.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';

export interface ProviderManagerConfig {
  configPath?: string;
  configProvider?: ConfigProvider;
  sessionProvider?: ProviderReference<SessionProvider>;
  toolProvider?: ProviderReference<ToolProvider>;
  memoryProvider?: ProviderReference<MemoryProvider>;
  compressor?: ProviderReference<ContextCompressor>;
  errorHandler?: ProviderReference<ErrorHandler>;
  skillProvider?: ProviderReference<SkillProvider>;
  budgetPolicy?: ProviderReference<BudgetPolicy>;
  toolPolicy?: ToolPolicyConfig;
  workspaceRoot?: string;
  readOnly?: boolean;
  skillsDir?: string;
  sessionsDir?: string;
}

export class ProviderManager {
  private static instance?: ProviderManager;
  private config: ProviderManagerConfig;
  private configProvider!: ConfigProvider;
  private registry!: ProviderRegistry;
  private initialized = false;

  static async getInstance(
    config?: ProviderManagerConfig,
  ): Promise<ProviderManager> {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager(config ?? {});
      await ProviderManager.instance.initialize();
    }
    return ProviderManager.instance;
  }

  static resetInstance(): void {
    ProviderManager.instance = undefined;
  }

  private constructor(config: ProviderManagerConfig) {
    registerBuiltInProviders();
    this.config = config;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    this.configProvider =
      this.config.configProvider ?? (await this.createDefaultConfigProvider());

    const behavior = this.configProvider.getBehaviorConfig();
    const toolCfg = this.configProvider.getToolConfig();

    const loader = new DefaultProviderLoader(builtinProviderResolver);
    const registry = new AgentProviderRegistry({
      loader,
      ctx: {
        kind: 'tool',
        agentName: behavior.name,
        workspaceRoot: this.config.workspaceRoot ?? behavior.workspaceRoot,
        readOnly: this.config.readOnly ?? behavior.readOnly ?? false,
        skillsDir: this.config.skillsDir ?? behavior.skillsDir ?? getDefaultSkillsDir(),
        sessionsDir: this.config.sessionsDir ?? behavior.sessionsDir ?? getDefaultSessionsDir(),
        maxTurns: behavior.maxTurns,
        toolPolicy: this.config.toolPolicy ?? toolCfg.policy,
      },
      refs: {
        sessionProvider: this.config.sessionProvider,
        toolProvider: this.config.toolProvider,
        memoryProvider: this.config.memoryProvider,
        compressor: this.config.compressor,
        errorHandler: this.config.errorHandler,
        skillProvider: this.config.skillProvider,
        budgetPolicy: this.config.budgetPolicy,
      },
    });

    await registry.initialize();
    this.registry = registry;
    this.initialized = true;
  }

  private async createDefaultConfigProvider(): Promise<ConfigProvider> {
    const provider = new DefaultConfigProvider({
      configPath: this.config.configPath,
    });
    await provider.init();
    return provider;
  }

  getConfigProvider(): ConfigProvider {
    return this.configProvider;
  }

  getModelConfig(modelId?: string): ResolvedModelConfig {
    return this.configProvider.getModelConfig(modelId);
  }

  getBehaviorConfig() {
    return this.configProvider.getBehaviorConfig();
  }

  getToolConfig() {
    return this.configProvider.getToolConfig();
  }

  get provider(): string {
    return this.getModelConfig().provider;
  }

  get providerConfig(): ProviderConfig {
    const cfg = this.getModelConfig();
    return {
      model: cfg.model,
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
    };
  }

  get<T>(kind: string): T | undefined {
    return this.registry.get(kind as any) as T | undefined;
  }

  require<T>(kind: string): T {
    return this.registry.require(kind as any) as T;
  }
}
