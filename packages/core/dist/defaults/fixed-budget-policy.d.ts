import type { BudgetPolicy, BudgetStatus } from '../sdk/budget-policy.js';
import type { AgentState } from '../state.js';
export interface FixedBudgetConfig {
    maxTurns: number;
    timeoutMs?: number;
}
export declare class FixedBudgetPolicy implements BudgetPolicy {
    private maxTurns;
    private timeoutMs;
    constructor(config: FixedBudgetConfig);
    checkTurn(state: AgentState): boolean;
    checkTimeout(startTime: number): boolean;
    shouldCircuitBreak(): boolean;
    getStatus(state: AgentState): BudgetStatus;
}
//# sourceMappingURL=fixed-budget-policy.d.ts.map