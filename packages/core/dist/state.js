import { randomUUID } from 'crypto';
import { IterationBudget } from './budget.js';
export class AgentState {
    sessionId;
    conversation = [];
    currentTurn = 0;
    budget;
    status = 'idle';
    maxTurns;
    constructor(budget) {
        this.sessionId = randomUUID();
        this.budget = budget ?? new IterationBudget({ maxTurns: 60 });
        this.maxTurns = this.budget.getStatus().turnsRemaining + this.budget.turnCount;
    }
    addMessage(msg) {
        this.conversation.push(msg);
    }
    canContinue() {
        return this.status === 'running' && this.budget.hasBudget();
    }
    reset() {
        this.conversation = [];
        this.currentTurn = 0;
        this.status = 'idle';
        this.budget = new IterationBudget({ maxTurns: this.maxTurns });
    }
}
//# sourceMappingURL=state.js.map