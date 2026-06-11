export class IterationBudget {
    config;
    turnCount = 0;
    consecutiveErrors = 0;
    sameToolFailures = new Map();
    constructor(config) {
        this.config = {
            maxTurns: config.maxTurns ?? Infinity,
            maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3,
            maxSameToolFailures: config.maxSameToolFailures ?? 5,
        };
    }
    checkTurn() {
        if (this.turnCount >= this.config.maxTurns)
            return false;
        this.turnCount++;
        return true;
    }
    hasBudget() {
        if (this.turnCount >= this.config.maxTurns)
            return false;
        if (this.consecutiveErrors >= this.config.maxConsecutiveErrors)
            return false;
        for (const count of this.sameToolFailures.values()) {
            if (count >= this.config.maxSameToolFailures)
                return false;
        }
        return true;
    }
    recordError(toolName) {
        this.consecutiveErrors++;
        if (toolName) {
            const current = this.sameToolFailures.get(toolName) ?? 0;
            this.sameToolFailures.set(toolName, current + 1);
        }
    }
    recordSuccess(toolName) {
        this.consecutiveErrors = 0;
        if (toolName)
            this.sameToolFailures.delete(toolName);
    }
    getStatus() {
        const turnsRemaining = Math.max(0, this.config.maxTurns - this.turnCount);
        const atRisk = turnsRemaining <= 3 || this.consecutiveErrors >= this.config.maxConsecutiveErrors - 1;
        let reason;
        if (this.turnCount >= this.config.maxTurns)
            reason = 'max_turns exceeded';
        else if (this.consecutiveErrors >= this.config.maxConsecutiveErrors)
            reason = 'max_consecutive_errors exceeded';
        return { turnsRemaining, consecutiveErrors: this.consecutiveErrors, atRisk, reason };
    }
}
//# sourceMappingURL=budget.js.map