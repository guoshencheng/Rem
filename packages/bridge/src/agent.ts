import type { ApprovalDecision, ApprovalRequest, AgentContext } from 'rem-agent-core';
import { runAgent as coreRunAgent, buildAgentContext, AgentState } from 'rem-agent-core';
import type { AgentContextBuildOptions } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentSessionManager } from './agent-session.js';
import type { WorkspaceRepository } from './workspace-repository.js';

export type AgentServiceOptions = AgentContextBuildOptions;

export class AgentService implements IAgentService {
  private options: AgentServiceOptions;
  private ctx: AgentContext | undefined;
  private sessionManager: AgentSessionManager | undefined;
  private agentState = new AgentState();
  private initialized = false;

  constructor(
    options: AgentServiceOptions,
    private workspaceRepository: WorkspaceRepository,
  ) {
    this.options = options;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.ctx = await buildAgentContext(this.options);
    this.sessionManager = new AgentSessionManager(this.ctx.sessionProvider, this.agentState);

    this.initialized = true;
  }

  get context(): AgentContext | undefined {
    return this.ctx;
  }

  get state(): AgentState {
    return this.agentState;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.ctx || !this.sessionManager) {
      throw new ServiceError('AgentService not initialized', 503);
    }
  }

  /* ---- Workspace management ---- */

  async listWorkspaces(): Promise<Workspace[]> {
    return this.workspaceRepository.list();
  }

  async addWorkspace(path: string): Promise<Workspace> {
    return this.workspaceRepository.add(path);
  }

  async removeWorkspace(path: string): Promise<void> {
    return this.workspaceRepository.remove(path);
  }

  /* ---- Agent lifecycle ---- */

  async run(workspace: string, sessionId: string, input: string): Promise<void> {
    this.ensureInitialized();

    if (this.agentState.isRunning(sessionId)) {
      throw new ServiceError('Session is already running', 409);
    }

    const abortController = this.agentState.startRun(sessionId, workspace);

    let result: ReturnType<typeof coreRunAgent>;
    try {
      result = coreRunAgent({
        input: { content: input, timestamp: new Date() },
        sessionId,
        signal: abortController.signal,
        ctx: this.ctx!,
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
    const consume = (async () => {
      for await (const chunk of result.stream.fullStream) {
        this.agentState.applyChunk(workspace, sessionId, chunk);
      }
    })();

    const outputGuard = result.output.then(
      () => new Promise<never>(() => {}),
      (err) => { throw err instanceof Error ? err : new Error(String(err)); },
    );

    try {
      await Promise.race([consume, outputGuard]);
    } catch (err) {
      // 主动中断（interrupt/reset）触发的 abort 算正常收尾，不算 error
      if (signal.aborted) {
        this.agentState.finishRun(sessionId, workspace);
      } else {
        const message = err instanceof Error ? err.message : String(err);
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
    this.agentState.abortRun(sessionId);
  }

  async reset(_workspace: string, sessionId: string): Promise<void> {
    this.agentState.abortRun(sessionId);
    this.agentState.finishRun(sessionId, 'default');
  }

  /* ---- Message tracking ---- */

  async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
    this.ensureInitialized();
    return this.sessionManager!.getMessages(sessionId);
  }

  async createSession(workspace: string): Promise<SessionSummary> {
    this.ensureInitialized();
    return this.sessionManager!.createSession(workspace);
  }

  async listSessions(workspace: string): Promise<SessionSummary[]> {
    this.ensureInitialized();
    const list = await this.sessionManager!.listSessions(workspace);
    return list.map((s) => ({
      ...s,
      activity: this.agentState.get(s.sessionId)?.activity ?? 'idle',
    }));
  }

  async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    this.ensureInitialized();
    return this.sessionManager!.updateSession(sessionId, updates);
  }

  async deleteSession(_workspace: string, sessionId: string): Promise<void> {
    this.ensureInitialized();
    return this.sessionManager!.deleteSession(sessionId);
  }

  /* ---- Approval ---- */

  async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
    this.ensureInitialized();
    const liveState = this.agentState.get(sessionId);
    return liveState?.pendingApprovals ?? [];
  }

  async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<boolean> {
    return this.agentState.resolveApproval(sessionId, approvalId, decision);
  }

  /* ---- Broadcast stream ---- */

  async *stream(): AsyncIterable<BusEvent> {
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
      for (const sessionId of this.agentState.runningSessionIds()) {
        const snapshot = this.agentState.getSnapshot(sessionId);
        const ws = this.agentState.get(sessionId)?.workspace ?? 'default';
        if (snapshot) {
          yield {
            workspace: ws,
            sessionId,
            type: 'snapshot',
            messageId: snapshot.messageId,
            parts: snapshot.parts,
          };
        }
      }

      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<BusEvent>((r) => { resolveNext = r; });
        }
      }
    } finally {
      unsub();
    }
  }
}
