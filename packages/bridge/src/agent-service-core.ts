import type { ApprovalDecision, ApprovalRequest, AgentContext, Rule, TodoItem, UserInputContent } from 'rem-agent-core/browser';
import { AgentState, runAgent as coreRunAgent, log, DefaultTodoService, AgentSessionManager, SessionNotFoundError } from 'rem-agent-core/browser';
import { compactContentBlocks } from 'rem-agent-core/stream/event-aggregators';
import type { TextContent, ThinkingContent, ToolCall } from 'rem-agent-core/browser';
import { ServiceError } from './errors.js';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';
import type { IAgentService } from './agent-service.interface.js';

export interface AgentServiceCoreDeps {
  ctx: AgentContext;
  agentState: AgentState;
}

/** IAgentService 的平台无关实现，AgentService（Node）与 LocalAgentService（浏览器）共用。 */
export class AgentServiceCore implements IAgentService {
  private ctx: AgentContext;
  private agentState: AgentState;
  private sessionManager: AgentSessionManager;

  constructor(deps: AgentServiceCoreDeps) {
    this.ctx = deps.ctx;
    this.agentState = deps.agentState;
    this.sessionManager = new AgentSessionManager(deps.ctx.sessionProvider, deps.agentState);
  }

  async init(): Promise<void> {
    // 初始化由外层服务（AgentService/LocalAgentService）负责
  }

  /* ---- Workspace management ---- */

  async listWorkspaces(): Promise<Workspace[]> {
    return this.ctx.storage.workspaceStore.list();
  }

  async addWorkspace(path: string): Promise<Workspace> {
    return this.ctx.storage.workspaceStore.add(path);
  }

  async removeWorkspace(path: string): Promise<void> {
    return this.ctx.storage.workspaceStore.remove(path);
  }

  /* ---- Agent lifecycle ---- */

  async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    if (this.agentState.isRunning(sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = this.agentState.startRun(sessionId, workspace);
    log('agent:lifecycle', 'run started', { sessionId, workspace, inputLength: input.length });

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        ctx: this.ctx,
        agentState: this.agentState,
        workspace,
        workspaceRoot: workspace,
      });
    } catch (err) {
      this.agentState.finishRun(sessionId, workspace, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    void this.drive(sessionId, workspace, abortController.signal, result);
  }

  private async drive(sessionId: string, workspace: string, signal: AbortSignal, result: ReturnType<typeof coreRunAgent>): Promise<void> {
    log('agent:lifecycle', 'consuming stream', { sessionId, workspace });

    const consume = (async () => {
      let chunkCount = 0;
      for await (const chunk of result.stream.fullStream) {
        this.agentState.applyChunk(workspace, sessionId, chunk);
        chunkCount++;
      }
      log('agent:lifecycle', 'stream consumed', { sessionId, workspace, chunkCount });
    })();

    const outputGuard = result.output.then(
      () => new Promise<never>(() => {}),
      (err) => { throw err instanceof Error ? err : new Error(String(err)); },
    );

    try {
      await Promise.race([consume, outputGuard]);
      log('agent:lifecycle', 'run finished normally', { sessionId, workspace });
    } catch (err) {
      // 主动中断（interrupt/reset）触发的 abort 算正常收尾，不算 error
      if (signal.aborted) {
        log('agent:lifecycle', 'run aborted by signal', { sessionId, workspace });
        this.agentState.finishRun(sessionId, workspace);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log('agent:lifecycle', 'run failed', { sessionId, workspace, error: message });
        this.agentState.finishRun(sessionId, workspace, { error: message });
      }
    }

    // 正常流结束：如果 applyChunk 没有触发 finishRun（例如 runAgent 已经直接调用了
    // liveState.finish），这里兜底确保会话状态被正确收尾并发布 session-end。
    if (this.agentState.isRunning(sessionId)) {
      this.agentState.finishRun(sessionId, workspace);
    }
  }

  async interrupt(_workspace: string, sessionId: string): Promise<void> {
    log('agent:lifecycle', 'interrupt requested', { sessionId });
    this.agentState.abortRun(sessionId);
  }

  async reset(_workspace: string, sessionId: string): Promise<void> {
    log('agent:lifecycle', 'reset requested', { sessionId });
    this.agentState.abortRun(sessionId);
    const ws = this.agentState.get(sessionId)?.workspace ?? 'default';
    this.agentState.finishRun(sessionId, ws);
  }

  /* ---- Message tracking ---- */

  async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
    return this.translateNotFound(() => this.sessionManager.getMessages(sessionId));
  }

  async getTodos(_workspace: string, sessionId: string): Promise<TodoItem[]> {
    return new DefaultTodoService(this.ctx.storage.todoStore).get(sessionId);
  }

  async createSession(workspace: string): Promise<SessionSummary> {
    return this.sessionManager.createSession(workspace);
  }

  async listSessions(workspace: string): Promise<SessionSummary[]> {
    const list = await this.sessionManager.listSessions(workspace);
    return list.map((s) => ({
      ...s,
      activity: this.agentState.get(s.sessionId)?.activity ?? 'idle',
    }));
  }

  async searchSessions(workspace: string, q: string): Promise<SessionSummary[]> {
    return this.sessionManager.searchSessions(workspace, q);
  }

  async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.translateNotFound(() => this.sessionManager.updateSession(sessionId, updates));
  }

  async deleteSession(_workspace: string, sessionId: string): Promise<void> {
    return this.translateNotFound(() => this.sessionManager.deleteSession(sessionId));
  }

  private async translateNotFound<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        throw new ServiceError(err.message, 404);
      }
      throw err;
    }
  }

  /* ---- Approval ---- */

  async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
    const liveState = this.agentState.get(sessionId);
    return liveState?.pendingApprovals ?? [];
  }

  async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): Promise<boolean> {
    // Persist the approved rule before resolving so the engine sees it immediately.
    if (decision === 'allow-always' && rule) {
      await this.ctx.storage.ruleStore.saveApproved(rule);
      this.ctx.ruleEngine.addRule({ ...rule, source: 'approved' });
    }
    return this.agentState.resolveApproval(sessionId, approvalId, decision, rule);
  }

  /* ---- Broadcast stream ---- */

  async *stream(signal?: AbortSignal): AsyncIterable<BusEvent> {
    const streamId = Math.random().toString(36).slice(2, 8);
    log('sse', 'stream() called', { streamId });
    const queue: BusEvent[] = [];
    let resolveNext: ((event: BusEvent) => void) | null = null;

    const unsub = this.agentState.subscribe((event) => {
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      // Replay in-flight snapshots for ALL workspaces to this new subscriber.
      // subscribe() above already ran synchronously, so any chunk published
      // after this point is queued — snapshot + queue are gap-free.
      const runningIds = this.agentState.runningSessionIds();
      log('sse', 'new bus subscriber', { streamId, runningSessions: runningIds.length });
      for (const sessionId of runningIds) {
        const snapshot = this.agentState.getSnapshot(sessionId);
        const ws = this.agentState.get(sessionId)?.workspace ?? 'default';
        if (snapshot) {
          const compactParts = compactContentBlocks(snapshot.parts as Array<TextContent | ThinkingContent | ToolCall | undefined>);
          log('sse', 'replaying snapshot', { sessionId, workspace: ws, messageId: snapshot.messageId, partCount: compactParts.length });
          yield {
            workspace: ws,
            sessionId,
            type: 'snapshot',
            messageId: snapshot.messageId,
            parts: compactParts,
          };
        }
      }

      while (true) {
        if (signal?.aborted) break;
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const event = await new Promise<BusEvent | null>((resolve) => {
            resolveNext = resolve;
            signal?.addEventListener('abort', () => resolve(null), { once: true });
          });
          if (event === null) break; // aborted
          yield event;
        }
      }
    } finally {
      unsub();
    }
  }
}
