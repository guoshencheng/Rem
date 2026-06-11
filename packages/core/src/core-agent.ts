import type { UserInput, AgentOutput, ModelMessage } from './types.js';
import type { LanguageModel } from 'ai';
import { AgentState } from './state.js';
import { AgentLoop } from './loop.js';
import { EventBus } from './events.js';
import { IterationBudget } from './budget.js';
import type { AgentEvent, EventHandler } from './events.js';

export interface CoreAgentConfig {
  name: string;
  model: LanguageModel;
  budget?: IterationBudget;
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
  }

  private _getLoop(): AgentLoop {
    if (!this.loop) {
      this.loop = new AgentLoop(this.config.model, this.events);
    }
    return this.loop;
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

    try {
      let turnNumber = this.state.currentTurn + 1;

      while (this.state.canContinue() && !this.interrupted) {
        const result = await this._getLoop().executeTurn({
          input,
          turnNumber,
          conversation: this.state.conversation,
          systemPrompt: `You are ${this.config.name}.`,
          availableTools: {} as import('ai').ToolSet,
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
    await this.events.emit('core-agent:init', { agent: this, state: this.state });
  }

  on(event: AgentEvent, handler: EventHandler): () => void {
    return this.events.on(event, handler);
  }

  once(event: AgentEvent, handler: EventHandler): void {
    this.events.once(event, handler);
  }
}
