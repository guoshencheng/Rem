import type { ModelMessage, ToolSet, LanguageModelUsage, LanguageModel } from 'ai';
import type { AgentState } from './state.js';
import type { EventBus } from './events.js';
import type { AgentOutput } from './types.js';
export interface TurnContext {
    input: {
        content: string;
    };
    turnNumber: number;
    conversation: ModelMessage[];
    systemPrompt: string;
    availableTools: ToolSet;
}
export interface TurnResult {
    output: AgentOutput;
    toolCalls: {
        toolCallId: string;
        toolName: string;
        input: unknown;
    }[];
    completed: boolean;
    shouldContinue: boolean;
    usage: LanguageModelUsage;
}
export declare class AgentLoop {
    private model;
    private events;
    constructor(model: LanguageModel, events: EventBus);
    executeTurn(ctx: TurnContext, state: AgentState): Promise<TurnResult>;
}
//# sourceMappingURL=loop.d.ts.map