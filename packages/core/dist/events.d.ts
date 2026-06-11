import type { AgentState } from './state.js';
export type AgentEvent = 'core-agent:init' | 'core-agent:start' | 'core-agent:error' | 'turn:before' | 'turn:after' | 'phase:prepare' | 'phase:reason:before' | 'phase:reason:after' | 'phase:execute:before' | 'phase:execute:after' | 'phase:observe' | 'phase:reflect' | 'tool:before' | 'tool:after' | 'tool:error' | 'compress:before' | 'compress:after';
export interface EventContext {
    agent: unknown;
    state: AgentState;
    turn?: unknown;
    turnResult?: unknown;
    toolCall?: unknown;
}
export type EventHandler = (ctx: EventContext) => Promise<void> | void;
export declare class EventBus {
    private handlers;
    on(event: AgentEvent, handler: EventHandler, priority?: number): () => void;
    once(event: AgentEvent, handler: EventHandler, priority?: number): void;
    emit(event: AgentEvent, ctx: EventContext): Promise<void>;
}
//# sourceMappingURL=events.d.ts.map