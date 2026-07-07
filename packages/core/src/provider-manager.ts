import { DefaultConfigProvider } from './plugins/config/default/index.js';
import { AgentProviderRegistry } from './registry/provider-registry.js';
import { DefaultProviderLoader } from './registry/provider-loader.js';
import { resolveBuiltinLoader } from './plugins/index.js';
import { registerBuiltInProviders } from './llm/providers/index.js';
import { ApprovalOrchestrator } from './security/approval-orchestrator.js';
import { ApprovalManager } from './security/approval-manager.js';
import { InMemoryAgentLiveProvider } from './plugins/state/in-memory/index.js';
import {
  createReadSkillToolDefinition,
  createReadSkillToolExecutor,
} from './plugins/tool/builtin/skill-read.js';
import { McpConnectionManager } from './mcp/connection-manager.js';
import { CompositeToolProvider } from './mcp/composite-tool-provider.js';
import type {
  ProviderKind,
  ProviderReference,
  ProviderRegistry,
} from './sdk/provider-loader.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ContextProvider } from './sdk/context-provider.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { LoopStrategy } from './sdk/loop-strategy.js';
import type { ReasonProvider } from './sdk/reason-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type {
  ConfigProvider,
  ResolvedModelConfig,
} from './sdk/config-provider.js';
import type { ProviderConfig } from './llm/types.js';
import { getDefaultSessionsDir } from './config/paths.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';
import type { AgentLiveProvider } from './sdk/agent-state-provider.js';

export interface ProviderManagerConfig {
  configPath?: string;
  configProvider?: ConfigProvider;
  sessionProvider?: SessionProvider;
  toolProvider?: ProviderReference<ToolProvider>;
  /** @deprecated Use contextProvider instead */
  memoryProvider?: ProviderReference<MemoryProvider>;
  contextProvider?: ProviderReference<ContextProvider>;
  compressor?: ProviderReference<ContextCompressor>;
  errorHandler?: ProviderReference<ErrorHandler>;
  skillProvider?: ProviderReference<SkillProvider>;
  budgetPolicy?: ProviderReference<BudgetPolicy>;
  titleProvider?: ProviderReference<TitleProvider>;
  loopStrategy?: ProviderReference<LoopStrategy>;
  reasonProvider?: ProviderReference<ReasonProvider>;
  toolPolicy?: ToolPolicyConfig;
  /** @deprecated Use agentLiveProvider instead */
  agentStateProvider?: AgentLiveProvider;
  agentLiveProvider?: AgentLiveProvider;
  workspaceRoot?: string;
  readOnly?: boolean;
  autoApproveDangerous?: boolean;
  sessionsDir?: string;
}

export class ProviderManager {
  private config: ProviderManagerConfig;
  private configProvider!: ConfigProvider;
  private registry!: ProviderRegistry;
  private initialized = false;
  private mcpManager?: McpConnectionManager;

  constructor(config: ProviderManagerConfig) {
    registerBuiltInProviders();
    this.config = config;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.configProvider =
      this.config.configProvider ?? (await this.createDefaultConfigProvider());

    const behavior = this.configProvider.getBehaviorConfig();
    const toolCfg = this.configProvider.getToolConfig();

    const liveProvider = this.config.agentLiveProvider ?? this.config.agentStateProvider ?? new InMemoryAgentLiveProvider();
    const approvalOrchestrator = new ApprovalOrchestrator(liveProvider, new ApprovalManager());

    const loader = new DefaultProviderLoader(resolveBuiltinLoader);
    const registry = new AgentProviderRegistry({
      loader,
      ctx: {
        kind: 'tool',
        agentName: behavior.name,
        workspaceRoot: this.config.workspaceRoot ?? behavior.workspaceRoot,
        readOnly: this.config.readOnly ?? behavior.readOnly ?? false,
        autoApproveDangerous: this.config.autoApproveDangerous ?? behavior.autoApproveDangerous ?? false,
        approvalOrchestrator,
        sessionsDir: this.config.sessionsDir ?? behavior.sessionsDir ?? getDefaultSessionsDir(),
        maxTurns: behavior.maxTurns,
        toolPolicy: this.config.toolPolicy ?? toolCfg.policy,
      },
      refs: {
        sessionProvider: this.config.sessionProvider,
        toolProvider: this.config.toolProvider,
        contextProvider: this.config.contextProvider ?? this.config.memoryProvider ?? 'simple',
        compressor: this.config.compressor,
        errorHandler: this.config.errorHandler,
        skillProvider: this.config.skillProvider,
        budgetPolicy: this.config.budgetPolicy,
        titleProvider: this.config.titleProvider,
        loopStrategy: this.config.loopStrategy ?? 'react',
        reasonProvider: this.config.reasonProvider ?? 'default',
      },
    });

    await registry.initialize();
    registry.register('approval', approvalOrchestrator);

    await this.attachMcpProviders(registry, approvalOrchestrator);

    this.registry = registry;
    this.registerSkillReadTool();
    this.initialized = true;
  }

  private async attachMcpProviders(
    registry: ProviderRegistry,
    approvalOrchestrator: ApprovalOrchestrator,
  ): Promise<void> {
    const toolProvider = registry.require<ToolProvider>('tool');
    const mcpConfig = this.configProvider.getMcpConfig();
    const mcpManager = new McpConnectionManager({ approvalOrchestrator });
    const mcpProviders = await mcpManager.connectAll(mcpConfig);

    if (mcpProviders.length > 0) {
      const composite = new CompositeToolProvider(toolProvider, mcpProviders);
      registry.register('tool', composite);
    }

    this.mcpManager = mcpManager;
  }

  private async createDefaultConfigProvider(): Promise<ConfigProvider> {
    const provider = new DefaultConfigProvider({
      configPath: this.config.configPath,
    });
    await provider.init();
    return provider;
  }

  private registerSkillReadTool(): void {
    const toolProvider = this.registry.get<ToolProvider>('tool');
    const skillProvider = this.registry.get<SkillProvider>('skill');

    if (!toolProvider || !skillProvider) {
      // eslint-disable-next-line no-console
      console.debug('[ProviderManager] skipped read_skill registration: tool or skill provider not available');
      return;
    }

    toolProvider.register(
      createReadSkillToolDefinition(),
      createReadSkillToolExecutor(() => this.registry.require<SkillProvider>('skill')),
    );
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
    return this.registry.require(kind as ProviderKind) as T;
  }

  register<T>(kind: string, provider: T): void {
    this.registry.register(kind as ProviderKind, provider);
  }

  getApprovalOrchestrator(): ApprovalOrchestrator {
    return this.require<ApprovalOrchestrator>('approval');
  }

  async close(): Promise<void> {
    await this.mcpManager?.closeAll();
  }
}

export async function createProviderManager(
  config?: ProviderManagerConfig,
): Promise<ProviderManager> {
  const pm = new ProviderManager(config ?? {});
  await pm.init();
  return pm;
}
