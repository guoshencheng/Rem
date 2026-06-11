export class FixedBudgetPolicy {
    maxTurns;
    timeoutMs;
    constructor(config) {
        this.maxTurns = config.maxTurns;
        this.timeoutMs = config.timeoutMs ?? 300_000; // 5 minutes default
    }
    checkTurn(state) {
        return state.currentTurn < this.maxTurns;
    }
    checkTimeout(startTime) {
        return Date.now() - startTime < this.timeoutMs;
    }
    shouldCircuitBreak() {
        return false; // P0: no circuit breaker
    }
    getStatus(state) {
        const turnsRemaining = Math.max(0, this.maxTurns - state.currentTurn);
        const atRisk = turnsRemaining <= 3;
        return {
            turnsRemaining,
            consecutiveErrors: 0,
            atRisk,
            reason: turnsRemaining === 0 ? 'max_turns exceeded' : undefined,
        };
    }
}
//# sourceMappingURL=fixed-budget-policy.js.map