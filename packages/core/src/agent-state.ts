import { AgentLiveState } from './state.js';
import { BroadcastBus } from './broadcast-bus.js';
import type { BusEvent, SessionActivity } from './bus-events.js';
import type { AgentStreamChunk, ContentPart } from './types.js';
import type { ApprovalDecision } from './sdk/agent-state-provider.js';

export class AgentState {
  private liveStates = new Map<string, AgentLiveState>();
  private bus = new BroadcastBus();

  get(sessionId: string): AgentLiveState | undefined {
    return this.liveStates.get(sessionId);
  }

  getOrCreate(sessionId: string): AgentLiveState {
    let state = this.liveStates.get(sessionId);
    if (!state) {
      state = new AgentLiveState();
      this.liveStates.set(sessionId, state);
    }
    return state;
  }

  set(sessionId: string, state: AgentLiveState): void {
    this.liveStates.set(sessionId, state);
  }

  runningSessionIds(): string[] {
    return [...this.liveStates.keys()];
  }

  subscribe(fn: (event: BusEvent) => void): () => void {
    return this.bus.subscribe(fn);
  }

  // ---- Bus events ----

  publish(event: BusEvent): void {
    this.bus.publish(event);
  }

  publishChunk(workspace: string, sessionId: string, chunk: AgentStreamChunk): void {
    this.bus.publish({ workspace, sessionId, type: 'chunk', chunk });
  }

  publishSessionStart(workspace: string, sessionId: string): void {
    this.bus.publish({ workspace, sessionId, type: 'session-start' });
  }

  publishSessionEnd(workspace: string, sessionId: string): void {
    this.bus.publish({ workspace, sessionId, type: 'session-end' });
  }

  publishSessionError(workspace: string, sessionId: string, error: string): void {
    this.bus.publish({ workspace, sessionId, type: 'session-error', error });
  }

  publishActivityChange(workspace: string, sessionId: string, activity: SessionActivity): void {
    this.bus.publish({ workspace, sessionId, type: 'activity-change', activity });
  }

  publishSnapshot(workspace: string, sessionId: string, messageId: string, parts: ContentPart[]): void {
    this.bus.publish({ workspace, sessionId, type: 'snapshot', messageId, parts });
  }

  // ---- Snapshot proxy ----

  startSnapshot(sessionId: string, messageId: string): void {
    this.getOrCreate(sessionId).startSnapshot(messageId);
  }

  appendSnapshotParts(sessionId: string, chunk: AgentStreamChunk): void {
    this.get(sessionId)?.appendSnapshotParts(chunk);
  }

  clearSnapshot(sessionId: string): void {
    this.get(sessionId)?.clearSnapshot();
  }

  getSnapshot(sessionId: string): import('./state.js').StreamingSnapshot | undefined {
    return this.get(sessionId)?.getSnapshot();
  }

  // ---- Run management ----

  isRunning(sessionId: string): boolean {
    return this.get(sessionId)?.status === 'running';
  }

  /**
   * 启动一个会话的运行。
   * 1. 校验当前状态是否可以开始（不能是 running）。
   * 2. 创建并注册 AbortController。
   * 3. 将 AgentLiveState 置为 running，设置初始 activity 为 pending。
   * 4. 发布 session-start 和 activity-change 事件。
   * 返回 AbortController 供调用方传入 runAgent。
   */
  startRun(sessionId: string, workspace: string): AbortController {
    const state = this.getOrCreate(sessionId);
    if (state.status === 'running') {
      throw new Error(`Session "${sessionId}" is already running`);
    }
    const controller = new AbortController();
    state.runController = controller;
    state.start({ clearSnapshot: true });
    state.setActivity('pending');
    this.publishSessionStart(workspace, sessionId);
    this.publishActivityChange(workspace, sessionId, 'pending');
    return controller;
  }

  /**
   * 结束一个会话的运行（幂等）。
   * 仅当当前状态为 running 时才发布事件并转换状态，重复调用直接返回，
   * 避免 reset/interrupt 主动结束后 drive 收尾时重复发事件。
   * - 无 error 时发布 session-end，并将状态置为 idle。
   * - 有 error 时发布 session-error，并将状态置为 error。
   * - 始终清除 snapshot 和 runController。
   */
  finishRun(
    sessionId: string,
    workspace: string,
    options?: { error?: string; clearSnapshot?: boolean },
  ): void {
    const state = this.get(sessionId);
    if (!state || state.status !== 'running') return;

    if (options?.error) {
      this.publishSessionError(workspace, sessionId, options.error);
      state.fail(options.error);
    } else {
      this.publishSessionEnd(workspace, sessionId);
      state.finish();
    }

    if (options?.clearSnapshot !== false) {
      state.clearSnapshot();
    }
    state.runController = undefined;
  }

  abortRun(sessionId: string): boolean {
    const state = this.get(sessionId);
    if (state?.runController) {
      state.runController.abort();
      return true;
    }
    return false;
  }

  removeRun(sessionId: string): void {
    const state = this.get(sessionId);
    if (state) {
      state.runController = undefined;
    }
  }

  remove(sessionId: string): void {
    this.liveStates.delete(sessionId);
  }

  // ---- Approval ----

  /** 等待某个会话的审批决策（按 sessionId 隔离 registry） */
  waitApproval(sessionId: string, approvalId: string, timeoutMs?: number): Promise<ApprovalDecision | null> {
    return this.getOrCreate(sessionId).approvalRegistry.wait(approvalId, timeoutMs);
  }

  /**
   * 解析某个会话的审批决策。按 sessionId 定位该会话的 registry。
   * 返回 true 表示找到并解析成功。
   */
  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    return this.get(sessionId)?.approvalRegistry.resolve(approvalId, decision) ?? false;
  }

  // ---- Activity / chunk ----

  /**
   * 应用一个流式 chunk，维护流式快照、更新 activity、必要时结束运行，并发布相关事件。
   * 只操作已存在的 AgentLiveState，不会新建。
   */
  applyChunk(workspace: string, sessionId: string, chunk: AgentStreamChunk): void {
    const state = this.get(sessionId);
    if (!state) return;

    // snapshot 维护：message-start 创建快照，其它 chunk 尝试追加到快照
    if (chunk.type === 'message-start') {
      state.startSnapshot(chunk.messageId);
    } else {
      try {
        state.appendSnapshotParts(chunk);
      } catch {
        // snapshot best-effort
      }
    }

    const prevActivity = state.activity;
    const nextActivity = state.applyChunk(chunk);

    if (nextActivity !== undefined && nextActivity !== prevActivity) {
      this.publishActivityChange(workspace, sessionId, nextActivity);
    }

    this.publishChunk(workspace, sessionId, chunk);

    // 运行生命周期收尾
    if (chunk.type === 'finish') {
      this.finishRun(sessionId, workspace);
    } else if (chunk.type === 'error') {
      this.finishRun(sessionId, workspace, { error: String(chunk.error) });
    }
  }
}
