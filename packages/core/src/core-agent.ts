import type { UserInput, AgentOutput, ModelMessage, ToolCallRecord, AgentStream } from './types.js';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { AgentEvent, EventHandler } from './events.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import type { SkillProvider } from './sdk/skill-provider.js';
import type { ConfigProvider, AgentBehaviorConfig } from './sdk/config-provider.js';
import type { ProviderReference, ProviderLoader, ProviderLoaderContext, ProviderRegistry } from './sdk/provider-loader.js';
import { registerBuiltInProviders } from './llm/providers/index.js';
import { resolveProviderConfig } from './llm/api-registry.js';
import type { ProviderConfig } from './llm/types.js';
import type { SessionProvider, SessionSummary } from './sdk/session-provider.js';
import type { TurnRunner, TurnHooks } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import type { LoopStrategy } from './loop-strategy.js';
import { ReactLoop } from './loop-strategy.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { InferenceEngine } from './llm/engine.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';
import type { ApprovalManager } from './security/approval-manager.js';
import { AgentStreamController } from './stream/agent-stream.js';
import { getDefaultSkillsDir, getDefaultSessionsDir } from './config/paths.js';
import { DefaultProviderLoader } from './registry/provider-loader.js';
import { AgentProviderRegistry } from './registry/provider-registry.js';
import { builtinProviderResolver } from './plugins/index.js';
import { FixedBudgetPolicy } from './plugins/budget/fixed/index.js';

export interface CoreAgentConfig {
  name?: string;
  budget?: IterationBudget;
  toolProvider?: ProviderReference<ToolProvider>;
  memoryProvider?: ProviderReference<MemoryProvider>;
  errorHandler?: ProviderReference<ErrorHandler>;
  budgetPolicy?: ProviderReference<BudgetPolicy>;
  compressor?: ProviderReference<ContextCompressor>;
  sessionProvider?: ProviderReference<SessionProvider>;
  turnRunner?: TurnRunner;
  loopStrategy?: LoopStrategy;
  skillProvider?: ProviderReference<SkillProvider>;
  configProvider?: ConfigProvider;
  provider?: string;
  providerConfig?: ProviderConfig;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  toolPolicy?: ToolPolicyConfig;
  providerLoader?: ProviderLoader;
}

export interface AgentStreamResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

interface ToolProviderWithApprovals extends ToolProvider {
  getApprovalManager(): ApprovalManager;
}

export class CoreAgent {
  private config: CoreAgentConfig;
  private resolvedBehavior: Required<AgentBehaviorConfig>;
  private resolvedProvider: { provider: string; providerConfig: ProviderConfig };
  private events: EventBus;
  private state: AgentState;
  private providerLoader: ProviderLoader;
  private registry!: ProviderRegistry;
  private turnRunner!: TurnRunner;
  private interrupted = false;
  private abortController?: AbortController;
  private budgetPolicy?: BudgetPolicy;
  private _ready = false;

  get isReady(): boolean {
    return this._ready;
  }

  get status() {
    return this.state.status;
  }

  get maxTurns(): number {
    const status = this.state.budget.getStatus();
    return status.turnsRemaining + this.state.budget.turnCount;
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  get name(): string {
    return this.resolvedBehavior.name;
  }

  constructor(config: CoreAgentConfig) {
    registerBuiltInProviders();
    this.config = config;
    this.resolvedBehavior = this.resolveBehaviorConfig(config);
    this.resolvedProvider = this.resolveProviderConfig(config);
    this.events = new EventBus();
    this.providerLoader = config.providerLoader ?? new DefaultProviderLoader(builtinProviderResolver);
    this.state = new AgentState(undefined, config.budget);
  }

  private resolveBehaviorConfig(config: CoreAgentConfig): Required<AgentBehaviorConfig> {
    const fromProvider = config.configProvider?.getBehaviorConfig?.();
    return {
      name: config.name ?? fromProvider?.name ?? 'Rem Agent',
      maxTurns: config.maxTurns ?? fromProvider?.maxTurns ?? 60,
      workspaceRoot: config.workspaceRoot ?? fromProvider?.workspaceRoot ?? process.cwd(),
      readOnly: config.readOnly ?? fromProvider?.readOnly ?? false,
      sessionsDir: fromProvider?.sessionsDir ?? getDefaultSessionsDir(),
      skillsDir: fromProvider?.skillsDir ?? getDefaultSkillsDir(),
    };
  }

  private resolveProviderConfig(config: CoreAgentConfig): { provider: string; providerConfig: ProviderConfig } {
    if (config.providerConfig) {
      return {
        provider: config.provider ?? 'openai',
        providerConfig: config.providerConfig,
      };
    }
    if (config.configProvider) {
      const cfg = config.configProvider.getModelConfig(config.provider);
      return {
        provider: cfg.provider,
        providerConfig: {
          model: cfg.model,
          apiKey: cfg.apiKey,
          baseURL: cfg.baseURL,
        },
      };
    }
    const provider = config.provider ?? 'openai';
    return { provider, providerConfig: resolveProviderConfig(provider) };
  }

  private createLoaderContext(): ProviderLoaderContext {
    return {
      kind: 'tool',
      agentName: this.name,
      workspaceRoot: this.resolvedBehavior.workspaceRoot,
      readOnly: this.resolvedBehavior.readOnly,
      skillsDir: this.resolvedBehavior.skillsDir,
      sessionsDir: this.resolvedBehavior.sessionsDir,
      maxTurns: this.resolvedBehavior.maxTurns,
      toolPolicy: this.config.configProvider?.getToolConfig?.().policy ?? this.config.toolPolicy,
    };
  }

  private createRegistry(): Promise<ProviderRegistry> {
    const registry = new AgentProviderRegistry({
      loader: this.providerLoader,
      ctx: this.createLoaderContext(),
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
    return registry.initialize().then(() => registry);
  }

  private async createDefaultTurnRunner(): Promise<TurnRunner> {
    const toolProvider = this.registry.require<ToolProvider>('tool');
    const loopStrategy =
      this.config.loopStrategy ??
      new ReactLoop(
        this.events,
        toolProvider,
        this.registry.require<MemoryProvider>('memory'),
        this.registry.require<ContextCompressor>('compressor'),
        this.registry.require<ErrorHandler>('error'),
        this.registry.get<SkillProvider>('skill'),
      );
    return new ReactTurnRunner(loopStrategy);
  }

  async ready(): Promise<void> {
    if (this._ready) {
      return;
    }
    this.registry = await this.createRegistry();
    this.turnRunner = this.config.turnRunner ?? (await this.createDefaultTurnRunner());
    this.budgetPolicy = this.registry.get<BudgetPolicy>('budget') ?? undefined;
    this._ready = true;
  }

  async initialize(options?: { sessionId?: string }): Promise<void> {
    if (!this._ready) {
      throw new Error('Providers not ready — call ready() before initialize()');
    }

    const sessionProvider = this.registry.require<SessionProvider>('session');

    if (options?.sessionId) {
      const session = await sessionProvider.load(options.sessionId);
      this.state = new AgentState(session ?? undefined, this.config.budget);
      if (!session) {
        this.state.session.sessionId = options.sessionId;
        await sessionProvider.save(this.state.session);
      }
    } else {
      this.state = new AgentState(undefined, this.config.budget);
      await sessionProvider.save(this.state.session);
    }
    this.state.status = 'idle';
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  get conversation(): ModelMessage[] {
    return [...this.state.conversation];
  }

  run(input: UserInput): AgentStreamResult {
    const controller = new AgentStreamController();
    const stream = controller.stream;

    const outputPromise = (async () => {
      this.state.status = 'running';
      this.interrupted = false;
      await this.events.emit('core-agent:start', { agent: this, state: this.state });

      const budgetPolicy = this.getBudgetPolicy();
      const startTime = Date.now();

      if (!budgetPolicy.checkTurn(this.state) || !budgetPolicy.checkTimeout(startTime)) {
        this.state.status = 'idle';
        const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
        controller.finish(output);
        return output;
      }

      const userMessage: ModelMessage = { role: 'user', content: input.content } as ModelMessage;
      this.state.addMessage(userMessage);
      const sessionProvider = this.registry.require<SessionProvider>('session');
      await sessionProvider.save(this.state.session);

      const abortController = new AbortController();
      this.abortController = abortController;

      try {
        const result = await this.turnRunner.run({
          input,
          conversation: [...this.state.conversation],
          systemPrompt: `You are ${this.name}.`,
          budget: this.state.budget,
          signal: abortController.signal,
          provider: this.resolvedProvider.provider,
          providerConfig: this.resolvedProvider.providerConfig,
          workspaceRoot: this.resolvedBehavior.workspaceRoot,
          readOnly: this.resolvedBehavior.readOnly,
          agentName: this.name,
        }, this.createTurnHooks(), controller);

        for (const msg of result.newMessages) {
          this.state.addMessage(msg);
        }

        this.state.currentTurn++;
        this.state.status = 'idle';
        this.abortController = undefined;
        await sessionProvider.save(this.state.session);
        await this.events.emit('core-agent:stop', { agent: this, state: this.state });

        const output: AgentOutput = {
          content: this.interrupted ? 'Response interrupted.' : result.output.content,
          completed: true,
        };
        controller.finish(output);
        return output;
      } catch (error) {
        this.state.status = 'error';
        this.abortController = undefined;
        const message = error instanceof Error ? error.message : String(error);
        const output: AgentOutput = {
          content: this.interrupted ? 'Response interrupted.' : `Error: ${message}`,
          completed: true,
        };
        await this.events.emit('core-agent:error', { agent: this, state: this.state });
        controller.finish(output);
        await sessionProvider.save(this.state.session);
        return output;
      }
    })();

    return { stream, output: outputPromise };
  }

  private createTurnHooks(): TurnHooks {
    return {
      onMessageAdded: (_msg: ModelMessage) => {
        if (this.interrupted) {
          return;
        }
      },
      onToolCallRecorded: (record: ToolCallRecord) => {
        this.state.session.metadata.lastToolCall = record;
      },
    };
  }

  interrupt(): void {
    this.interrupted = true;
    this.abortController?.abort();
  }

  resolveToolApproval(
    approvalId: string,
    decision: 'allow-once' | 'allow-always' | 'deny',
  ): boolean {
    const provider = this.registry.get<ToolProvider>('tool') as ToolProviderWithApprovals | undefined;
    if (!provider || typeof provider.getApprovalManager !== 'function') return false;
    return provider.getApprovalManager().resolve(approvalId, decision);
  }

  async generateTitle(): Promise<string> {
    if (this.state.session.metadata.title) {
      return this.state.session.metadata.title as string;
    }

    const userMessages = this.state.conversation.filter(
      (m) => m.role === 'user',
    );
    if (userMessages.length === 0) return '';

    const provider = this.resolvedProvider.provider;
    const providerConfig = this.resolvedProvider.providerConfig;
    const engine = new InferenceEngine();

    try {
      const result = await engine.infer({
        provider,
        providerConfig,
        system: 'Generate a concise title (10 words or fewer) summarizing the conversation topic from the user messages below. Respond with ONLY the title text, no quotes or markup.',
        messages: [...userMessages].map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        maxTokens: 50,
        temperature: 0.3,
      });

      const title = result.text.trim().slice(0, 80);
      if (title) {
        this.state.session.metadata.title = title;
        await this.registry.require<SessionProvider>('session').save(this.state.session);
      }
      return title;
    } catch {
      return '';
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.registry.require<SessionProvider>('session').list();
  }

  async reset(): Promise<void> {
    this.state.reset();
    this.turnRunner = this.config.turnRunner ?? (await this.createDefaultTurnRunner());
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }

  private getBudgetPolicy(): BudgetPolicy {
    if (!this.budgetPolicy) {
      const maxTurns = this.config.budget
        ? this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount
        : this.resolvedBehavior.maxTurns;
      this.budgetPolicy = new FixedBudgetPolicy({ maxTurns });
    }
    return this.budgetPolicy;
  }
}

export function createAgentFromEnv(options?: {
  name?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTurns?: number;
  sessionProvider?: ProviderReference<SessionProvider>;
  skillProvider?: ProviderReference<SkillProvider>;
  configProvider?: ConfigProvider;
  configPath?: string;
  workspaceRoot?: string;
  readOnly?: boolean;
  toolPolicy?: ToolPolicyConfig;
}): CoreAgent {
  registerBuiltInProviders();
  const configProvider = options?.configProvider;
  const behavior = configProvider?.getBehaviorConfig?.();
  const modelCfg = configProvider?.getModelConfig?.(options?.provider);
  const provider = options?.provider ?? modelCfg?.provider ?? 'openai';

  const providerConfig: ProviderConfig | undefined =
    options?.provider !== undefined
      ? {
          model: options.model ?? '',
          apiKey: options.apiKey ?? '',
          baseURL: options.baseURL,
        }
      : options?.model !== undefined || options?.apiKey !== undefined || options?.baseURL !== undefined
        ? {
            model: options.model ?? modelCfg?.model ?? '',
            apiKey: options.apiKey ?? modelCfg?.apiKey ?? '',
            baseURL: options.baseURL ?? modelCfg?.baseURL,
          }
        : modelCfg
          ? {
              model: modelCfg.model,
              apiKey: modelCfg.apiKey,
              baseURL: modelCfg.baseURL,
            }
          : undefined;

  const name = options?.name ?? behavior?.name ?? 'Rem Agent';
  const maxTurns = options?.maxTurns ?? behavior?.maxTurns ?? 60;

  return new CoreAgent({
    name,
    budget: new IterationBudget({ maxTurns }),
    provider,
    providerConfig,
    sessionProvider: options?.sessionProvider,
    skillProvider: options?.skillProvider ?? 'file',
    workspaceRoot: options?.workspaceRoot ?? behavior?.workspaceRoot,
    readOnly: options?.readOnly ?? behavior?.readOnly,
    toolPolicy: options?.toolPolicy ?? configProvider?.getToolConfig?.().policy,
    configProvider,
  });
}
