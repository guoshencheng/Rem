import type {
  AgentDI, AgentRuntimeConfig, ApprovalDecision, ApprovalRequest, Rule,
  TodoItem, UserInputContent,
} from 'rem-agent-core';
import {
  BroadcastBus, DefaultTodoService, SessionNotFoundError, buildChildContext,
  compactContentBlocks, log,
  type BusEvent, type SessionInfo, type SessionUpdate, type TextContent,
  type ThinkingContent, type TokenUsageDetail, type ToolCall, type ToolContext,
  type UIMessage, type WorkspaceRecord,
} from 'rem-agent-core';
import { REMAgent, resolveREMAgentContext, type DelegateTaskInputV2 } from 'rem-agent-core-v2';
import type { IAgentService } from 'rem-agent-bridge';
import { REMSessions } from './rem-sessions.js';
import type { REMSession } from './rem-session.js';
import { SessionService } from './session-service.js';
import { WorkspaceService } from './workspace-service.js';
import { AgentService } from './agent-service.js';
import { ServiceError } from './errors.js';

export class AgentsUniService implements IAgentService {
  readonly sessions: REMSessions;
  readonly sessionService: SessionService;
  readonly workspaceService: WorkspaceService;
  readonly agentService: AgentService;

  private readonly bus = new BroadcastBus();

  constructor(
    private readonly di: AgentDI,
    private readonly runtimeConfig: AgentRuntimeConfig,
  ) {
    const publish = (e: BusEvent) => this.bus.publish(e);
    this.sessions = new REMSessions(publish);
    this.sessionService = new SessionService(di);
    this.workspaceService = new WorkspaceService(di);
    this.agentService = new AgentService({ sessionService: this.sessionService, publish });
  }

  /* ---- Workspace ---- */

  listWorkspaces(): Promise<WorkspaceRecord[]> { return this.workspaceService.list(); }
  addWorkspace(path: string): Promise<WorkspaceRecord> { return this.workspaceService.add(path); }
  removeWorkspace(path: string): Promise<void> { return this.workspaceService.remove(path); }

  /* ---- 运行控制 ---- */

  async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing?.status === 'running') {
      throw new ServiceError('Session is already running', 409);
    }

    const session = await this.sessionService.loadOrCreate(sessionId, workspace);
    const remSession = this.sessions.getOrCreate(sessionId, workspace);
    const controller = remSession.startRun();
    log('uni', 'run started', { sessionId, workspace });

    // 恢复累计 token usage（原 runAgent 行为）
    if (remSession.tokenUsage.totalTokens === 0) {
      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []) as TokenUsageDetail[];
      if (history.length > 0) remSession.restoreTokenUsage(history);
    }

    if (!remSession.budget.hasBudget() || !this.di.budgetPolicy.checkTimeout(Date.now())) {
      remSession.finishRun('Budget exceeded.');
      return;
    }

    try {
      const context = await resolveREMAgentContext({
        di: this.di,
        runtimeConfig: this.runtimeConfig,
        session,
        workspace,
        workspaceRoot: workspace,
      });
      const remAgent = new REMAgent({
        context,
        di: this.di,
        runtimeConfig: this.runtimeConfig,
        session,
        workspace,
        agentId: 'root',
        sessionId,
        signal: controller.signal,
        approvalState: { getOrCreate: () => remSession },
        publishBus: (e) => this.bus.publish(e),
        spawnChild: (childInput, toolCtx) => this.spawnChild(remSession, 'root', childInput, toolCtx),
      });
      remSession.agents.push(remAgent);
      this.agentService.run(remSession, remAgent, { content: input, timestamp: new Date() });
    } catch (err) {
      remSession.finishRun(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async spawnChild(remSession: REMSession, parentAgentId: string, input: DelegateTaskInputV2, toolCtx: ToolContext): Promise<REMAgent> {
    const childSession = await this.sessionService.createChildSession({
      parentSessionId: remSession.sessionId,
      parentToolCallId: toolCtx.toolCallId,
      workspace: remSession.workspace,
      title: input.task.slice(0, 50),
    });
    const child = buildChildContext(this.di, this.runtimeConfig, {
      maxTurns: input.maxTurns,
      systemPrompt: input.systemPrompt,
    });
    const childAgentId = `${parentAgentId}.delegate-${remSession.agents.length}`;
    const context = await resolveREMAgentContext({
      di: child.di,
      runtimeConfig: child.runtimeConfig,
      session: childSession,
      workspace: remSession.workspace,
      workspaceRoot: toolCtx.workspaceRoot,
    });
    const remAgent = new REMAgent({
      context,
      di: child.di,
      runtimeConfig: child.runtimeConfig,
      session: childSession,
      workspace: remSession.workspace,
      agentId: childAgentId,
      sessionId: childSession.sessionId,
      summary: input.task,
      signal: toolCtx.signal,
      approvalState: { getOrCreate: () => remSession },
      publishBus: (e) => this.bus.publish(e),
      spawnChild: (grandInput, grandCtx) => this.spawnChild(remSession, childAgentId, grandInput, grandCtx),
    });
    remSession.agents.push(remAgent);
    return remAgent;
  }

  private rootAgent(sessionId: string): REMAgent {
    const remSession = this.sessions.get(sessionId);
    const root = remSession?.agents[0];
    if (!remSession || remSession.status !== 'running' || !root) {
      throw new ServiceError('Session is not running', 409);
    }
    return root;
  }

  async steer(_workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    this.rootAgent(sessionId).steer(input);
  }

  async followUp(_workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    this.rootAgent(sessionId).followUp(input);
  }

  async interrupt(_workspace: string, sessionId: string): Promise<void> {
    log('uni', 'interrupt requested', { sessionId });
    this.sessions.get(sessionId)?.runController?.abort();
  }

  async reset(_workspace: string, sessionId: string): Promise<void> {
    log('uni', 'reset requested', { sessionId });
    const remSession = this.sessions.get(sessionId);
    remSession?.runController?.abort();
    remSession?.finishRun();
  }

  /* ---- Session 查询 ---- */

  async createSession(workspace: string): Promise<SessionInfo> {
    return this.sessionService.create(workspace);
  }

  async listSessions(workspace: string): Promise<SessionInfo[]> {
    const list = await this.sessionService.listByWorkspace(workspace);
    return list.map((s) => ({
      ...s,
      activity: this.sessions.get(s.sessionId)?.activity ?? 'idle',
    }));
  }

  async searchSessions(workspace: string, q: string): Promise<SessionInfo[]> {
    return this.sessionService.search(workspace, q);
  }

  async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
    return this.translateNotFound(() => this.sessionService.getMessages(sessionId));
  }

  async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.translateNotFound(() => this.sessionService.update(sessionId, updates));
  }

  async deleteSession(_workspace: string, sessionId: string): Promise<void> {
    const remSession = this.sessions.get(sessionId);
    remSession?.runController?.abort();
    this.sessions.remove(sessionId);
    return this.translateNotFound(() => this.sessionService.delete(sessionId));
  }

  async getTodos(_workspace: string, sessionId: string): Promise<TodoItem[]> {
    return new DefaultTodoService(this.di.storage.todoStore).get(sessionId);
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

  /* ---- 审批 ---- */

  async listPendingApprovals(_workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
    return this.sessions.get(sessionId)?.pendingApprovals ?? [];
  }

  async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): Promise<boolean> {
    if (decision === 'allow-always' && rule) {
      await this.di.storage.ruleStore.saveApproved(rule);
      this.di.ruleEngine.addRule({ ...rule, source: 'approved' });
    }
    return this.sessions.get(sessionId)?.approvalEngine.resolve(approvalId, decision, rule) ?? false;
  }

  /* ---- 全局总流（含 snapshot 回放，移植 agent.ts:227-277）---- */

  async *stream(signal?: AbortSignal): AsyncIterable<BusEvent> {
    const queue: BusEvent[] = [];
    let resolveNext: ((event: BusEvent) => void) | null = null;

    const unsub = this.bus.subscribe((event) => {
      if (resolveNext) {
        resolveNext(event);
        resolveNext = null;
      } else {
        queue.push(event);
      }
    });

    try {
      for (const remSession of this.sessions.running()) {
        const snapshot = remSession.getSnapshot();
        if (snapshot) {
          const compactParts = compactContentBlocks(snapshot.parts as Array<TextContent | ThinkingContent | ToolCall | undefined>);
          yield {
            workspace: remSession.workspace,
            sessionId: remSession.sessionId,
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
          if (event === null) break;
          yield event;
        }
      }
    } finally {
      unsub();
    }
  }
}
