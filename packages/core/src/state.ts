import { randomUUID } from 'crypto';
import type { ModelMessage, AgentStatus } from './types.js';
import { IterationBudget } from './budget.js';
import type { Session } from './session.js';

export class AgentState {
  readonly session: Session;
  budget: IterationBudget;
  status: AgentStatus = 'idle';
  private maxTurns: number;

  get sessionId(): string {
    return this.session.sessionId;
  }

  get conversation(): ModelMessage[] {
    return this.session.conversation;
  }

  set conversation(value: ModelMessage[]) {
    this.session.conversation = value;
  }

  get currentTurn(): number {
    return this.session.currentTurn;
  }

  set currentTurn(value: number) {
    this.session.currentTurn = value;
  }

  constructor(session?: Session, budget?: IterationBudget) {
    this.session = session ?? {
      sessionId: randomUUID(),
      conversation: [],
      currentTurn: 0,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.budget = budget ?? new IterationBudget({ maxTurns: 60 });
    this.maxTurns = this.budget.getStatus().turnsRemaining + this.budget.turnCount;
  }

  addMessage(msg: ModelMessage): void {
    this.session.conversation.push(msg);
  }

  canContinue(): boolean {
    return this.status === 'running' && this.budget.hasBudget();
  }

  reset(): void {
    this.session.conversation = [];
    this.session.currentTurn = 0;
    this.status = 'idle';
    this.budget = new IterationBudget({ maxTurns: this.maxTurns });
  }
}
