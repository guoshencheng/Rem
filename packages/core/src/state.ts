import { randomUUID } from 'crypto';
import type { ModelMessage, AgentStatus } from './types.js';
import { IterationBudget } from './budget.js';

export class AgentState {
  readonly sessionId: string;
  conversation: ModelMessage[] = [];
  currentTurn = 0;
  budget: IterationBudget;
  status: AgentStatus = 'idle';
  private maxTurns: number;

  constructor(budget?: IterationBudget) {
    this.sessionId = randomUUID();
    this.budget = budget ?? new IterationBudget({ maxTurns: 60 });
    this.maxTurns = this.budget.getStatus().turnsRemaining + this.budget.turnCount;
  }

  addMessage(msg: ModelMessage): void {
    this.conversation.push(msg);
  }

  canContinue(): boolean {
    return this.status === 'running' && this.budget.hasBudget();
  }

  reset(): void {
    this.conversation = [];
    this.currentTurn = 0;
    this.status = 'idle';
    this.budget = new IterationBudget({ maxTurns: this.maxTurns });
  }
}
