import type { UserInput, AgentOutput, ModelMessage } from './types.js';
import type { LanguageModel } from 'ai';
import { IterationBudget } from './budget.js';
import type { AgentEvent, EventHandler } from './events.js';
export interface CoreAgentConfig {
    name: string;
    model: LanguageModel;
    budget?: IterationBudget;
}
export declare class CoreAgent {
    private config;
    private loop;
    private events;
    private state;
    private interrupted;
    get status(): import("./types.js").AgentStatus;
    constructor(config: CoreAgentConfig);
    private _getLoop;
    initialize(options?: {
        sessionId?: string;
        messages?: ModelMessage[];
    }): Promise<void>;
    run(input: UserInput): Promise<AgentOutput>;
    interrupt(): void;
    reset(): Promise<void>;
    on(event: AgentEvent, handler: EventHandler): () => void;
    once(event: AgentEvent, handler: EventHandler): void;
}
//# sourceMappingURL=core-agent.d.ts.map