import { IterationBudget } from './budget.js';
import type { AgentStatus, ContentPart } from './types.js';
import type { EventBus } from './events.js';
import type { ApprovalRequest } from './sdk/agent-state-provider.js';

/**
 * 跨请求存活的 Agent 运行时状态。
 * 不持有 Session（会话长期持久化由 SessionProvider 负责）。
 * 状态变更必须通过方法，自动通过 EventBus 发出 agent:state-change 事件。
 */
export class AgentLiveState {
  private _status: AgentStatus = 'idle';
  private _budget: IterationBudget;
  private _maxTurns: number;
  private _events?: EventBus;

  /** 待处理的审批请求 */
  pendingApprovals: ApprovalRequest[] = [];

  /** 当前会话的流式快照（用于重连） */
  streamingSnapshot?: ContentPart[];

  get status(): AgentStatus { return this._status; }

  get budget(): IterationBudget { return this._budget; }

  constructor(budget?: IterationBudget, events?: EventBus) {
    this._budget = budget ?? new IterationBudget({ maxTurns: 60 });
    this._maxTurns = this._budget.getStatus().turnsRemaining + this._budget.turnCount;
    this._events = events;
  }

  // ---- 状态机 ----

  start(): void {
    const prev = this._status;
    if (prev !== 'idle') {
      throw new Error(`AgentLiveState: cannot start from "${prev}"`);
    }
    this._status = 'running';
    void this._events?.emit('agent:state-change', {
      agent: this,
      liveState: this,
      prevStatus: prev,
      currentStatus: 'running',
    });
  }

  finish(): void {
    const prev = this._status;
    if (prev !== 'running') {
      throw new Error(`AgentLiveState: cannot finish from "${prev}"`);
    }
    this._status = 'idle';
    void this._events?.emit('agent:state-change', {
      agent: this,
      liveState: this,
      prevStatus: prev,
      currentStatus: 'idle',
    });
  }

  fail(error?: unknown): void {
    const prev = this._status;
    if (prev !== 'running') {
      throw new Error(`AgentLiveState: cannot fail from "${prev}"`);
    }
    this._status = 'error';
    void this._events?.emit('agent:state-change', {
      agent: this,
      liveState: this,
      prevStatus: prev,
      currentStatus: 'error',
      error,
    });
  }

  reset(): void {
    const prev = this._status;
    this._status = 'idle';
    this._budget = new IterationBudget({ maxTurns: this._maxTurns });
    void this._events?.emit('agent:state-change', {
      agent: this,
      liveState: this,
      prevStatus: prev,
      currentStatus: 'idle',
    });
  }

  canContinue(): boolean {
    return this._status === 'running' && this._budget.hasBudget();
  }

  // ---- Budget 代理 ----

  consumeTurn(): boolean {
    return this._budget.hasBudget();
  }
}
