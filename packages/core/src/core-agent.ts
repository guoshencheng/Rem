import type { UserInput, AgentOutput, Message, AgentStatus, ModelConfig } from './types.js';
import { AgentState } from './state.js';
import { AgentLoop } from './loop.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { ModelClient } from './model-client.js';
import type { AgentEvent, EventHandler } from './events.js';

export interface AgentHarnessConfig {
  name: string;
  modelConfig: ModelConfig;
  modelClient?: ModelClient;
  budget?: IterationBudget;
}

export class AgentHarness {
  private config: AgentHarnessConfig;
  private loop: AgentLoop | null = null;
  private events: EventBus;
  private state: AgentState;
  private modelClient: ModelClient | null = null;
  private interrupted = false;

  get status(): AgentStatus {
    return this.state.status;
  }

  constructor(config: AgentHarnessConfig) {
    this.config = config;
    this.events = new EventBus();
    this.state = new AgentState(config.budget);
  }

  private _getModelClient(): ModelClient {
    if (!this.modelClient) {
      this.modelClient = this.config.modelClient ?? this._createDefaultModelClient(this.config.modelConfig);
    }
    return this.modelClient;
  }

  private _getLoop(): AgentLoop {
    if (!this.loop) {
      this.loop = new AgentLoop(this._getModelClient(), this.events);
    }
    return this.loop;
  }

  private _createDefaultModelClient(_config: ModelConfig): ModelClient {
    throw new Error(
      'No ModelClient provided. Use OpenAICompatibleClient from "src/plugins/model-providers/openai-compatible.ts" or provide a custom implementation.'
    );
  }

  async initialize(options?: { sessionId?: string; messages?: Message[] }): Promise<void> {
    if (options?.sessionId) {
      this.state = new AgentState(this.config.budget);
      (this.state as any).sessionId = options.sessionId;
    }
    if (options?.messages) {
      this.state.conversation = options.messages;
    }
    this.state.status = 'idle';
    await this.events.emit('harness:init', { harness: this, state: this.state });
  }

  async run(input: UserInput): Promise<AgentOutput> {
    this.state.status = 'running';
    this.interrupted = false;
    await this.events.emit('harness:start', { harness: this, state: this.state });

    try {
      let turnNumber = this.state.currentTurn + 1;

      while (this.state.canContinue() && !this.interrupted) {
        const result = await this._getLoop().executeTurn({
          input,
          turnNumber,
          conversation: this.state.conversation,
          systemPrompt: `You are ${this.config.name}.`,
          availableTools: [],
        }, this.state);

        if (result.completed || this.interrupted) {
          this.state.status = 'idle';
          return {
            content: this.interrupted
              ? 'Response interrupted.'
              : result.output.content,
            toolCalls: result.toolCalls,
            completed: true,
          };
        }

        turnNumber++;
      }

      this.state.status = 'idle';
      return {
        content: this.interrupted
          ? 'Response interrupted.'
          : 'Budget exceeded.',
        toolCalls: [],
        completed: true,
      };
    } catch (error) {
      this.state.status = 'error';
      await this.events.emit('harness:error', { harness: this, state: this.state });
      throw error;
    }
  }

  interrupt(): void {
    this.interrupted = true;
  }

  async reset(): Promise<void> {
    this.state.reset();
    await this.events.emit('harness:init', { harness: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }
}
