import { AgentState } from './state.js';
import { AgentLoop } from './loop.js';
import { EventBus } from './events.js';
export class CoreAgent {
    config;
    loop = null;
    events;
    state;
    interrupted = false;
    get status() {
        return this.state.status;
    }
    constructor(config) {
        this.config = config;
        this.events = new EventBus();
        this.state = new AgentState(config.budget);
    }
    _getLoop() {
        if (!this.loop) {
            this.loop = new AgentLoop(this.config.model, this.events);
        }
        return this.loop;
    }
    async initialize(options) {
        if (options?.sessionId) {
            this.state = new AgentState(this.config.budget);
            this.state.sessionId = options.sessionId;
        }
        if (options?.messages) {
            this.state.conversation = options.messages;
        }
        this.state.status = 'idle';
        await this.events.emit('core-agent:init', { agent: this, state: this.state });
    }
    async run(input) {
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
                    availableTools: {},
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
        }
        catch (error) {
            this.state.status = 'error';
            await this.events.emit('core-agent:error', { agent: this, state: this.state });
            throw error;
        }
    }
    interrupt() {
        this.interrupted = true;
    }
    async reset() {
        this.state.reset();
        await this.events.emit('core-agent:init', { agent: this, state: this.state });
    }
    on(event, handler) {
        return this.events.on(event, handler);
    }
    once(event, handler) {
        this.events.once(event, handler);
    }
}
//# sourceMappingURL=core-agent.js.map