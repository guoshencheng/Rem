import { IterationBudget } from './budget.js';
import type { AgentStatus } from './types.js';

/**
 * 跨请求存活的 Agent 运行时状态。
 * 不持有 Session（会话长期持久化由 SessionProvider 负责）。
 * 状态变更必须通过方法，不允许外部直接赋值。
 */
export class AgentLiveState {
  private _status: AgentStatus = 'idle';
  private _budget: IterationBudget;
  private _maxTurns: number;

  get status(): AgentStatus { return this._status; }

  get budget(): IterationBudget { return this._budget; }

  constructor(budget?: IterationBudget) {
    this._budget = budget ?? new IterationBudget({ maxTurns: 60 });
    this._maxTurns = this._budget.getStatus().turnsRemaining + this._budget.turnCount;
  }

  // ---- 状态机 ----

  start(): void {
    if (this._status !== 'idle') {
      throw new Error(`AgentLiveState: cannot start from "${this._status}"`);
    }
    this._status = 'running';
  }

  finish(): void {
    if (this._status !== 'running') {
      throw new Error(`AgentLiveState: cannot finish from "${this._status}"`);
    }
    this._status = 'idle';
  }

  fail(): void {
    if (this._status !== 'running') {
      throw new Error(`AgentLiveState: cannot fail from "${this._status}"`);
    }
    this._status = 'error';
  }

  reset(): void {
    this._status = 'idle';
    this._budget = new IterationBudget({ maxTurns: this._maxTurns });
  }

  canContinue(): boolean {
    return this._status === 'running' && this._budget.hasBudget();
  }

  // ---- Budget 代理 ----

  consumeTurn(): boolean {
    return this._budget.hasBudget();
  }
}
