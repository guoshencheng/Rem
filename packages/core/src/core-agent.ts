import type { UserInput, AgentOutput, ModelMessage } from './types.js';
import type { LanguageModel } from 'ai';
import { AgentState } from './state.js';
import { AgentLoop } from './loop.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { AgentEvent, EventHandler } from './events.js';
import type { ToolProvider } from './sdk/tool-provider.js';
import type { MemoryProvider } from './sdk/memory-provider.js';
import type { ErrorHandler } from './sdk/error-handler.js';
import type { BudgetPolicy } from './sdk/budget-policy.js';
import type { ContextCompressor } from './sdk/compressor.js';
import { InMemoryToolProvider } from './defaults/in-memory-tool-provider.js';
import { SimpleMemoryProvider } from './defaults/simple-memory-provider.js';
import { SimpleErrorHandler } from './defaults/simple-error-handler.js';
import { FixedBudgetPolicy } from './defaults/fixed-budget-policy.js';
import { NoOpCompressor } from './defaults/no-op-compressor.js';
import { registerBuiltInProviders } from './llm/providers/index.js';

export interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  budget?: IterationBudget;
  toolProvider?: ToolProvider;
  memoryProvider?: MemoryProvider;
  errorHandler?: ErrorHandler;
  budgetPolicy?: BudgetPolicy;
  compressor?: ContextCompressor;
  provider?: string;
  providerConfig?: {
    apiKey: string;
    baseURL?: string;
    model: string;
  };
}

export class CoreAgent {
  private config: CoreAgentConfig;
  private loop: AgentLoop | null = null;
  private events: EventBus;
  private state: AgentState;
  private interrupted = false;

  get status() {
    return this.state.status;
  }

  constructor(config: CoreAgentConfig) {
    this.config = config;
    this.events = new EventBus();
    this.state = new AgentState(config.budget);
    registerBuiltInProviders();
  }

  private _getLoop(): AgentLoop {
    if (!this.loop) {
      this.loop = new AgentLoop(
        this.config.model,
        this.events,
        this.config.toolProvider ?? new InMemoryToolProvider(),
        this.config.memoryProvider ?? new SimpleMemoryProvider(this.config.name),
        this.config.compressor ?? new NoOpCompressor(),
      );
    }
    return this.loop;
  }

  private _getBudgetPolicy(): BudgetPolicy {
    return this.config.budgetPolicy ?? new FixedBudgetPolicy({
      maxTurns: this.state.budget.getStatus().turnsRemaining + this.state.budget.turnCount,
    });
  }

  private _getErrorHandler(): ErrorHandler {
    return this.config.errorHandler ?? new SimpleErrorHandler();
  }

  async initialize(options?: { sessionId?: string; messages?: ModelMessage[] }): Promise<void> {
    if (options?.sessionId) {
      this.state = new AgentState(this.config.budget);
      (this.state as any).sessionId = options.sessionId;
    }
    if (options?.messages) {
      this.state.conversation = options.messages;
    }
    this.state.status = 'idle';
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  async run(input: UserInput): Promise<AgentOutput> {
    this.state.status = 'running';
    this.interrupted = false;
    await this.events.emit('core-agent:start', { agent: this, state: this.state });

    const budgetPolicy = this._getBudgetPolicy();
    const errorHandler = this._getErrorHandler();
    const startTime = Date.now();
    let turnNumber = this.state.currentTurn + 1;

    try {
      while (this.state.canContinue() && !this.interrupted) {
        if (!budgetPolicy.checkTurn(this.state) || !budgetPolicy.checkTimeout(startTime)) {
          break;
        }

        try {
          const result = await this._getLoop().executeTurn({
            input,
            turnNumber,
            conversation: this.state.conversation,
            systemPrompt: `You are ${this.config.name}.`,
            availableTools: {},
            provider: this.config.provider ?? 'openai',
            providerConfig: this.config.providerConfig ?? {
              apiKey: '',
              model: 'gpt-4o',
            },
          }, this.state);

          if (result.completed || this.interrupted) {
            this.state.status = 'idle';
            return {
              content: this.interrupted
                ? 'Response interrupted.'
                : result.output.content,
              completed: true,
            };
          }

          turnNumber++;
        } catch (error) {
          const category = errorHandler.classify(error);
          if (!errorHandler.isRetryable(category)) {
            this.state.status = 'error';
            await this.events.emit('core-agent:error', { agent: this, state: this.state });
            throw error;
          }

          const instruction = errorHandler.getRetryInstruction(category);
          if (instruction) {
            input = { content: `${input.content}\n\n[System: ${instruction}]` };
          }

          turnNumber++;
        }
      }

      this.state.status = 'idle';
      return {
        content: this.interrupted
          ? 'Response interrupted.'
          : 'Budget exceeded.',
        completed: true,
      };
    } catch (error) {
      this.state.status = 'error';
      await this.events.emit('core-agent:error', { agent: this, state: this.state });
      throw error;
    }
  }

  interrupt(): void {
    this.interrupted = true;
  }

  async reset(): Promise<void> {
    this.state.reset();
    this.loop = null;
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }
}
