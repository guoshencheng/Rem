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
import { SimpleMemoryProvider } from './defaults/simple-memory-provider.js';
import { FixedBudgetPolicy } from './defaults/fixed-budget-policy.js';
import { NoOpCompressor } from './defaults/no-op-compressor.js';
import { FileSkillProvider } from './plugins/file-skill-provider.js';
import { registerBuiltInProviders } from './llm/providers/index.js';
import { resolveProviderConfig } from './llm/api-registry.js';
import type { ProviderConfig } from './llm/types.js';
import type { SessionProvider, SessionSummary } from './session.js';
import { InMemorySessionProvider } from './session.js';
import type { TurnRunner, TurnHooks } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import type { LoopStrategy } from './loop-strategy.js';
import { ReactLoop } from './loop-strategy.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { SimpleErrorHandler } from './defaults/simple-error-handler.js';
import { InferenceEngine } from './llm/engine.js';
import { createFileSystemTools } from './plugins/tools/index.js';
import type { ToolPolicyConfig } from './sdk/tool-policy.js';
import type { ApprovalManager } from './security/approval-manager.js';
import { AgentStreamController } from './stream/agent-stream.js';
import { getDefaultSkillsDir, getDefaultSessionsDir } from './config/paths.js';

export interface CoreAgentConfig {
  name?: string;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  sessionProvider?: SessionProvider;
  turnRunner?: TurnRunner;
  loopStrategy?: LoopStrategy;
  skillProvider?: SkillProvider;
  configProvider?: ConfigProvider;
  provider?: string;
  providerConfig?: ProviderConfig;
  maxTurns?: number;
  workspaceRoot?: string;
  readOnly?: boolean;
  toolPolicy?: ToolPolicyConfig;
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
  private sessionProvider: SessionProvider;
  private turnRunner: TurnRunner;
  private toolProvider?: ToolProvider;
  private interrupted = false;
  private abortController?: AbortController;
  private budgetPolicy?: BudgetPolicy;

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
    this.sessionProvider = config.sessionProvider ?? new InMemorySessionProvider();
    this.turnRunner = config.turnRunner ?? this.createDefaultTurnRunner();
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

  private createDefaultTurnRunner(): TurnRunner {
    const workspaceRoot = this.resolvedBehavior.workspaceRoot;
    this.toolProvider =
      this.config.toolProvider ??
      createFileSystemTools({
        workspaceRoot,
        readOnly: this.resolvedBehavior.readOnly,
        toolPolicy: this.config.configProvider?.getToolConfig?.().policy ?? this.config.toolPolicy,
      });
    const loopStrategy =
      this.config.loopStrategy ??
      new ReactLoop(
        this.events,
        this.toolProvider,
        this.config.memoryProvider ?? new SimpleMemoryProvider(this.name),
        this.config.compressor ?? new NoOpCompressor(),
        this.config.errorHandler ?? new SimpleErrorHandler(),
        this.config.skillProvider ?? new FileSkillProvider({ skillsDir: this.resolvedBehavior.skillsDir }),
      );
    return new ReactTurnRunner(loopStrategy);
  }

  async initialize(options?: { sessionId?: string }): Promise<void> {
    if (options?.sessionId) {
      const session = await this.sessionProvider.load(options.sessionId);
      this.state = new AgentState(session ?? undefined, this.config.budget);
      if (!session) {
        this.state.session.sessionId = options.sessionId;
        await this.sessionProvider.save(this.state.session);
      }
    } else {
      this.state = new AgentState(undefined, this.config.budget);
      await this.sessionProvider.save(this.state.session);
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

      // Add user message to Session
      const userMessage: ModelMessage = { role: 'user', content: input.content } as ModelMessage;
      this.state.addMessage(userMessage);
      await this.sessionProvider.save(this.state.session);

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
        await this.sessionProvider.save(this.state.session);
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
        await this.sessionProvider.save(this.state.session);
        return output;
      }
    })();

    return { stream, output: outputPromise };
  }

  private createTurnHooks(): TurnHooks {
    return {
      // Intentionally a no-op/observation hook: ReactLoop already adds messages
      // to internal state; CoreAgent updates session from result.newMessages after
      // the turn completes.
      onMessageAdded: (msg: ModelMessage) => {
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
    const provider = this.toolProvider as ToolProviderWithApprovals | undefined;
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
        await this.sessionProvider.save(this.state.session);
      }
      return title;
    } catch {
      return '';
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.sessionProvider.list();
  }

  async reset(): Promise<void> {
    this.state.reset();
    this.turnRunner = this.config.turnRunner ?? this.createDefaultTurnRunner();
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }

  private getBudgetPolicy(): BudgetPolicy {
    const maxTurns = this.config.budget
      ? this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount
      : this.resolvedBehavior.maxTurns;
    return this.budgetPolicy ??= this.config.budgetPolicy ?? new FixedBudgetPolicy({ maxTurns });
  }
}

export function createAgentFromEnv(options?: {
  name?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTurns?: number;
  sessionProvider?: SessionProvider;
  skillProvider?: SkillProvider;
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
    skillProvider: options?.skillProvider ?? new FileSkillProvider({ skillsDir: behavior?.skillsDir ?? getDefaultSkillsDir() }),
    workspaceRoot: options?.workspaceRoot ?? behavior?.workspaceRoot,
    readOnly: options?.readOnly ?? behavior?.readOnly,
    toolPolicy: options?.toolPolicy ?? configProvider?.getToolConfig?.().policy,
    configProvider,
  });
}
