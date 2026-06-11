export interface BudgetConfig {
    maxTurns: number;
    maxConsecutiveErrors: number;
    maxSameToolFailures: number;
}
export interface BudgetStatus {
    turnsRemaining: number;
    consecutiveErrors: number;
    atRisk: boolean;
    reason?: string;
}
export declare class IterationBudget {
    private config;
    turnCount: number;
    consecutiveErrors: number;
    sameToolFailures: Map<string, number>;
    constructor(config: Partial<BudgetConfig>);
    checkTurn(): boolean;
    hasBudget(): boolean;
    recordError(toolName?: string): void;
    recordSuccess(toolName?: string): void;
    getStatus(): BudgetStatus;
}
//# sourceMappingURL=budget.d.ts.map