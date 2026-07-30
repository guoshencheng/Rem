import type { TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai';
import type { Usage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { AgentStatus, AgentStreamEvent } from './types.js';
import type { EventBus } from './events.js';
import type { ApprovalRequest } from './sdk/agent-state-provider.js';
import type { SessionActivity } from './bus-events.js';
import { IterationBudget } from './budget.js';
import { ApprovalEngine } from './execute/approval-engine.js';
import { reduceStreamEvent, compactContentBlocks } from './stream/event-aggregators.js';
import { addUsage, emptyUsage } from './token-usage.js';
import { log } from './shared/debug-log.js';

export interface StreamingSnapshot {
  messageId: string;
  parts: Array<TextContent | ThinkingContent | ToolCall | undefined>;
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

  /** 当前会话所属的 workspace */
  workspace?: string;

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

  /** 当前会话的审批引擎（管理审批 Promise，无超时） */
  readonly approvalEngine = new ApprovalEngine('');

  /** 当前会话累计 token usage */
  tokenUsage: Usage = emptyUsage();

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
    log('state', 'status changed to running', { prevStatus: prev });
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
    log('state', 'status changed to idle');
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
    const message = error instanceof Error ? error.message : String(error ?? '');
    log('state', 'status changed to error', { error: message });
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

  // ---- Token Usage ----

  addTokenUsage(usage: Usage): void {
    this.tokenUsage = addUsage(this.tokenUsage, usage);
  }

  applyChunk(event: AgentStreamEvent): SessionActivity | undefined {
    const prev = this.activity;

    if (event.type === 'finish' || event.type === 'error') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (event.type === 'turn_start') {
      this.activity = 'pending';
    } else if (event.type === 'turn_end') {
      this.activity = 'idle';
      this.pendingToolCalls.clear();
    } else if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      this.activity = 'calling-function';
    } else if (event.type === 'message_update') {
      this.applyAssistantEvent(event.assistantMessageEvent);
    }

    if (this.activity !== prev) {
      log('state', 'activity changed', { prevActivity: prev, activity: this.activity, chunkType: event.type });
    }

    return this.activity === prev ? undefined : this.activity;
  }

  private applyAssistantEvent(event: AssistantMessageEvent): void {
    if (event.type === 'thinking_delta' || event.type === 'thinking_start') {
      this.activity = 'thinking';
    } else if (event.type === 'toolcall_start') {
      this.activity = 'calling-function';
      const block = event.partial.content?.[event.contentIndex];
      if (block?.type === 'toolCall') {
        this.pendingToolCalls.add(block.id ?? 'unknown');
      }
    } else if (event.type === 'toolcall_end') {
      this.activity = 'calling-function';
      this.pendingToolCalls.add(event.toolCall.id ?? 'unknown');
    } else if (event.type === 'text_delta' || event.type === 'text_start') {
      if (this._isActive() && this.pendingToolCalls.size === 0) {
        this.activity = 'outputting';
      }
    } else if (event.type === 'text_end' || event.type === 'thinking_end') {
      this.activity = this.pendingToolCalls.size > 0 ? 'calling-function' : 'idle';
    }
  }

  private _isActive(): boolean {
    return this._status === 'running';
  }

  // ---- Snapshot ----

  startSnapshot(messageId: string): void {
    this.streamingSnapshot = { messageId, parts: [] };
  }

  appendSnapshotParts(event: AgentStreamEvent): void {
    if (this.streamingSnapshot && event.type === 'message_update') {
      this.streamingSnapshot.parts = reduceStreamEvent(this.streamingSnapshot.parts, event.assistantMessageEvent);
    }
  }

  clearSnapshot(): void {
    this.streamingSnapshot = undefined;
  }

  getSnapshot(): StreamingSnapshot | undefined {
    return this.streamingSnapshot;
  }

  getSnapshotParts(): Array<TextContent | ThinkingContent | ToolCall> {
    return this.streamingSnapshot ? compactContentBlocks(this.streamingSnapshot.parts) : [];
  }
}
