import type { AgentStatus, ContentPart, AgentStreamChunk } from './types.js';
import type { EventBus } from './events.js';
import type { ApprovalRequest } from './sdk/agent-state-provider.js';
import type { SessionActivity } from './bus-events.js';
import { IterationBudget } from './budget.js';
import { ApprovalRegistry } from './execute/approval-registry.js';
import { reduceStreamChunk } from './stream/stream-aggregators.js';

export interface StreamingSnapshot {
  messageId: string;
  parts: ContentPart[];
}

export interface StartOptions {
  /** 启动时是否重置 budget，默认在从 error 恢复时为 true */
  resetBudget?: boolean;
  /** 启动时是否清除流式 snapshot */
  clearSnapshot?: boolean;
}

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
  streamingSnapshot?: StreamingSnapshot;

  /** 当前会话的运行 AbortController */
  runController?: AbortController;

  /** 当前会话的 UI 活动状态 */
  activity: SessionActivity = 'idle';

  /** 当前待处理的 tool call id 集合 */
  pendingToolCalls = new Set<string>();

  /** 当前会话的审批注册表（管理审批 Promise） */
  readonly approvalRegistry = new ApprovalRegistry();

  get status(): AgentStatus { return this._status; }

  get budget(): IterationBudget { return this._budget; }

  constructor(budget?: IterationBudget, events?: EventBus) {
    this._budget = budget ?? new IterationBudget({ maxTurns: 60 });
    this._maxTurns = this._budget.getStatus().turnsRemaining + this._budget.turnCount;
    this._events = events;
  }

  /** 重新绑定 EventBus，用于 runAgent 复用 provider 中已有的 AgentLiveState */
  attachEvents(events: EventBus): void {
    this._events = events;
  }

  // ---- 状态机 ----

  start(options?: StartOptions): void {
    const prev = this._status;
    if (prev === 'running') {
      throw new Error(`AgentLiveState: cannot start from "${prev}"`);
    }

    const shouldResetBudget = options?.resetBudget ?? (prev === 'error');
    if (shouldResetBudget) {
      this._budget = new IterationBudget({ maxTurns: this._maxTurns });
    }

    if (options?.clearSnapshot) {
      this.streamingSnapshot = undefined;
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
    this.runController = undefined;
    this.activity = 'idle';
    this.pendingToolCalls.clear();
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
    this.runController = undefined;
    this.activity = 'idle';
    this.pendingToolCalls.clear();
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
    this.runController = undefined;
    this.activity = 'idle';
    this.pendingToolCalls.clear();
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

  // ---- Activity ----

  setActivity(activity: SessionActivity): void {
    this.activity = activity;
  }

  applyChunk(chunk: AgentStreamChunk): SessionActivity | undefined {
    const prev = this.activity;

    if (chunk.type === 'finish' || chunk.type === 'error') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (chunk.type === 'reasoning-start' || chunk.type === 'reasoning-delta') {
      this.activity = 'thinking';
    } else if (chunk.type === 'tool-call-start' || chunk.type === 'tool-call') {
      this.activity = 'calling-function';
      this.pendingToolCalls.add(chunk.toolCallId);
    } else if (chunk.type === 'tool-result-start' || chunk.type === 'tool-result' || chunk.type === 'tool-result-finish') {
      // 只移除待处理工具调用，不改变 activity（保持 calling-function）
      this.pendingToolCalls.delete(chunk.toolCallId);
    } else if (chunk.type === 'text-start' || chunk.type === 'text-delta') {
      if (this._isActive() && this.pendingToolCalls.size === 0) {
        this.activity = 'outputting';
      }
    } else if (chunk.type === 'step-finish') {
      this.activity = this.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
      this.pendingToolCalls.clear();
    } else if (chunk.type === 'text-finish' || chunk.type === 'reasoning-finish') {
      this.activity = this.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
    }

    return this.activity === prev ? undefined : this.activity;
  }

  private _isActive(): boolean {
    return this._status === 'running';
  }

  // ---- Snapshot ----

  startSnapshot(messageId: string): void {
    this.streamingSnapshot = { messageId, parts: [] };
  }

  appendSnapshotParts(chunk: AgentStreamChunk): void {
    if (this.streamingSnapshot) {
      this.streamingSnapshot.parts = reduceStreamChunk(this.streamingSnapshot.parts, chunk);
    }
  }

  clearSnapshot(): void {
    this.streamingSnapshot = undefined;
  }

  getSnapshot(): StreamingSnapshot | undefined {
    return this.streamingSnapshot;
  }
}
