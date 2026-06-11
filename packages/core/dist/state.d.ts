import type { ModelMessage, AgentStatus } from './types.js';
import { IterationBudget } from './budget.js';
export declare class AgentState {
    readonly sessionId: string;
    conversation: ModelMessage[];
    currentTurn: number;
    budget: IterationBudget;
    status: AgentStatus;
    private maxTurns;
    constructor(budget?: IterationBudget);
    addMessage(msg: ModelMessage): void;
    canContinue(): boolean;
    reset(): void;
}
//# sourceMappingURL=state.d.ts.map