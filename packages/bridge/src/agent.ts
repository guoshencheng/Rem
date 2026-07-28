import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApprovalDecision, ApprovalRequest, AgentDI, AgentRuntimeConfig, Rule, TodoItem, UserInputContent } from 'rem-agent-core';
import { AgentState, initRuleEngine, runAgent as coreRunAgent, log, DefaultTodoService, AgentSessionManager, SessionNotFoundError } from 'rem-agent-core';
import { compactContentBlocks } from 'rem-agent-core/stream/event-aggregators';
import type { TextContent, ThinkingContent, ToolCall } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';
import type { IAgentService } from './agent-service.interface.js';

export class AgentService implements IAgentService {
  private _di: AgentDI;
  private _runtimeConfig: AgentRuntimeConfig;
  private agentState: AgentState;
  private sessionManager: AgentSessionManager;
  private initialized = false;

  constructor(di: AgentDI, runtimeConfig: AgentRuntimeConfig) {
    this._di = di;
    this._runtimeConfig = runtimeConfig;
    this.agentState = new AgentState();
    this.sessionManager = new AgentSessionManager(di.sessionProvider, this.agentState);
  }

  get di(): AgentDI {
    return this._di;
  }

  get runtimeConfig(): AgentRuntimeConfig {
    return this._runtimeConfig;
  }

  get state(): AgentState {
    return this.agentState;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this._di.configProvider.init();
    await this._di.storage.init();
    await initRuleEngine(this._di);
    this._di.mcpProviders = await this._di.mcpManager.connectAll(this._di.configProvider.getMcpConfig());

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ServiceError('AgentService not initialized', 503);
    }
  }

  /* ---- Workspace management ---- */

  async listWorkspaces(): Promise<Workspace[]> {
    this.ensureInitialized();
    return this._di.storage.workspaceStore.list();
  }

  async addWorkspace(rawPath: string): Promise<Workspace> {
    return this._addWorkspace(await this.resolveWorkspaceDir(rawPath));
  }

  private async _addWorkspace(path: string): Promise<Workspace> {
    this.ensureInitialized();
    return this._di.storage.workspaceStore.add(path);
  }

  async removeWorkspace(rawPath: string): Promise<void> {
    this.ensureInitialized();
    return this._di.storage.workspaceStore.remove(path.resolve(rawPath));
  }

  private async resolveWorkspaceDir(rawPath: string): Promise<string> {
    const absolutePath = path.resolve(rawPath);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        throw new Error(`Workspace path is not a directory: ${absolutePath}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Workspace path does not exist or is not readable: ${absolutePath} (${message})`);
    }
    return absolutePath;
  }

  /* ---- Agent lifecycle ---- */

  async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    this.ensureInitialized();
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
        di: this._di,
        runtimeConfig: this._runtimeConfig,
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
      if (signal.aborted) {
        log('agent:lifecycle', 'run aborted by signal', { sessionId, workspace });
        this.agentState.finishRun(sessionId, workspace);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log('agent:lifecycle', 'run failed', { sessionId, workspace, error: message });
        this.agentState.finishRun(sessionId, workspace, { error: message });
      }
    }

    if (this.agentState.isRunning(sessionId)) {
      this.agentState.finishRun(sessionId, workspace);
    }
  }

  async interrupt(_workspace: string, sessionId: string): Promise<void> {
    this.ensureInitialized();
    log('agent:lifecycle', 'interrupt requested', { sessionId });
    this.agentState.abortRun(sessionId);
  }

  async reset(_workspace: string, sessionId: string): Promise<void> {
    this.ensureInitialized();
    log('agent:lifecycle', 'reset requested', { sessionId });
    this.agentState.abortRun(sessionId);
    const ws = this.agentState.get(sessionId)?.workspace ?? 'default';
    this.agentState.finishRun(sessionId, ws);
  }

  /* ---- Message tracking ---- */

  async getMessages(_workspace: string, sessionId: string): Promise<UIMessage[]> {
    this.ensureInitialized();
    return this.translateNotFound(() => this.sessionManager.getMessages(sessionId));
  }

  async getTodos(_workspace: string, sessionId: string): Promise<TodoItem[]> {
    this.ensureInitialized();
    return new DefaultTodoService(this._di.storage.todoStore).get(sessionId);
  }

  async createSession(workspace: string): Promise<SessionSummary> {
    this.ensureInitialized();
    return this.sessionManager.createSession(workspace);
  }

  async listSessions(workspace: string): Promise<SessionSummary[]> {
    this.ensureInitialized();
    const list = await this.sessionManager.listSessions(workspace);
    return list.map((s) => ({
      ...s,
      activity: this.agentState.get(s.sessionId)?.activity ?? 'idle',
    }));
  }

  async searchSessions(workspace: string, q: string): Promise<SessionSummary[]> {
    this.ensureInitialized();
    return this.sessionManager.searchSessions(workspace, q);
  }

  async updateSession(_workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    this.ensureInitialized();
    return this.translateNotFound(() => this.sessionManager.updateSession(sessionId, updates));
  }

  async deleteSession(_workspace: string, sessionId: string): Promise<void> {
    this.ensureInitialized();
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
    this.ensureInitialized();
    const liveState = this.agentState.get(sessionId);
    return liveState?.pendingApprovals ?? [];
  }

  async resolveApproval(_workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): Promise<boolean> {
    this.ensureInitialized();
    if (decision === 'allow-always' && rule) {
      await this._di.storage.ruleStore.saveApproved(rule);
      this._di.ruleEngine.addRule({ ...rule, source: 'approved' });
    }
    return this.agentState.resolveApproval(sessionId, approvalId, decision, rule);
  }

  /* ---- Broadcast stream ---- */

  async *stream(signal?: AbortSignal): AsyncIterable<BusEvent> {
    this.ensureInitialized();
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
          if (event === null) break;
          yield event;
        }
      }
    } finally {
      unsub();
    }
  }
}
