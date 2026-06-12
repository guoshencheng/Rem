import type { UserInput, AgentOutput, ModelMessage } from './types.js';
import type { LanguageModel } from 'ai';
import { AgentState } from './state.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { AgentEvent, EventHandler } from './events.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import { InMemoryToolProvider } from './defaults/in-memory-tool-provider.js';
import { SimpleMemoryProvider } from './defaults/simple-memory-provider.js';
import { FixedBudgetPolicy } from './defaults/fixed-budget-policy.js';
import { NoOpCompressor } from './defaults/no-op-compressor.js';
import type { SessionProvider } from './session.js';
import { InMemorySessionProvider } from './session.js';
import type { TurnRunner, TurnHooks } from './turn.js';
import { ReactTurnRunner } from './turn.js';
import type { LoopStrategy } from './loop-strategy.js';
import { ReactLoop } from './loop-strategy.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import { SimpleErrorHandler } from './defaults/simple-error-handler.js';

export interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  sessionProvider?: SessionProvider;
  turnRunner?: TurnRunner;
  loopStrategy?: LoopStrategy;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export class CoreAgent {
  private config: CoreAgentConfig;
  private events: EventBus;
  private state: AgentState;
  private sessionProvider: SessionProvider;
  private turnRunner: TurnRunner;
  private interrupted = false;
  private abortController?: AbortController;
  private budgetPolicy?: BudgetPolicy;

  get status() {
    return this.state.status;
  }

  constructor(config: CoreAgentConfig) {
    this.config = config;
    this.events = new EventBus();
    this.sessionProvider = config.sessionProvider ?? new InMemorySessionProvider();
    this.turnRunner = config.turnRunner ?? this.createDefaultTurnRunner();
    this.state = new AgentState(undefined, config.budget);
  }

  private createDefaultTurnRunner(): TurnRunner {
    const loopStrategy = this.config.loopStrategy ?? new ReactLoop(
      this.config.model,
      this.events,
      this.config.toolProvider ?? new InMemoryToolProvider(),
      this.config.memoryProvider ?? new SimpleMemoryProvider(this.config.name),
      this.config.compressor ?? new NoOpCompressor(),
      this.config.errorHandler ?? new SimpleErrorHandler(),
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

  async run(input: UserInput): Promise<AgentOutput> {
    this.state.status = 'running';
    this.interrupted = false;
    await this.events.emit('core-agent:start', { agent: this, state: this.state });

    const budgetPolicy = this.getBudgetPolicy();
    const startTime = Date.now();

    if (!budgetPolicy.checkTurn(this.state) || !budgetPolicy.checkTimeout(startTime)) {
      this.state.status = 'idle';
      return { content: 'Budget exceeded.', completed: true };
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
        systemPrompt: `You are ${this.config.name}.`,
        model: this.config.model,
        budget: this.state.budget,
        signal: abortController.signal,
        provider: this.config.provider ?? 'openai',
        providerConfig: this.config.providerConfig ?? { apiKey: '', model: 'gpt-4o' },
      }, this.createTurnHooks());

      for (const msg of result.newMessages) {
        this.state.addMessage(msg);
      }

      this.state.currentTurn++;
      this.state.status = 'idle';
      this.abortController = undefined;
      await this.sessionProvider.save(this.state.session);
      await this.events.emit('core-agent:stop', { agent: this, state: this.state });

      return {
        content: this.interrupted ? 'Response interrupted.' : result.output.content,
        completed: true,
      };
    } catch (error) {
      this.state.status = 'error';
      this.abortController = undefined;
      await this.events.emit('core-agent:error', { agent: this, state: this.state });
      throw error;
    }
  }

  private createTurnHooks(): TurnHooks {
    return {
      // Intentionally a no-op/observation hook: ReactLoop already adds messages
      // to internal state; CoreAgent updates session from result.newMessages after
      // the turn completes.
      onMessageAdded: (msg) => {
        if (this.interrupted) {
          return;
        }
      },
      onToolCallRecorded: (record) => {
        this.state.session.metadata.lastToolCall = record;
      },
    };
  }

  interrupt(): void {
    this.interrupted = true;
    this.abortController?.abort();
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
    return this.budgetPolicy ??= this.config.budgetPolicy ?? new FixedBudgetPolicy({
      maxTurns: this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount,
    });
  }
}
