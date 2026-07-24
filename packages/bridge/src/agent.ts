import type { ApprovalDecision, ApprovalRequest, AgentContext, Rule, TodoItem, UserInputContent } from 'rem-agent-core';
import { buildAgentContext, AgentState } from 'rem-agent-core';
import type { AgentContextBuildOptions } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentSessionManager } from './agent-session.js';
import { AgentServiceCore } from './agent-service-core.js';
import type { WorkspaceRepository } from './workspace-repository.js';

export type AgentServiceOptions = AgentContextBuildOptions;

export class AgentService implements IAgentService {
  private options: AgentServiceOptions;
  private ctx: AgentContext | undefined;
  private agentState = new AgentState();
  private core: AgentServiceCore | undefined;
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
    this.core = new AgentServiceCore({
      ctx: this.ctx,
      agentState: this.agentState,
      sessionManager: new AgentSessionManager(this.ctx.sessionProvider, this.agentState),
      workspaceRepository: this.workspaceRepository,
    });

    this.initialized = true;
  }

  get context(): AgentContext | undefined {
    return this.ctx;
  }

  get state(): AgentState {
    return this.agentState;
  }

  private ensureCore(): AgentServiceCore {
    if (!this.initialized || !this.core) {
      throw new ServiceError('AgentService not initialized', 503);
    }
    return this.core;
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

  async run(workspace: string, sessionId: string, input: UserInputContent): Promise<void> {
    return this.ensureCore().run(workspace, sessionId, input);
  }

  async interrupt(workspace: string, sessionId: string): Promise<void> {
    return this.ensureCore().interrupt(workspace, sessionId);
  }

  async reset(workspace: string, sessionId: string): Promise<void> {
    return this.ensureCore().reset(workspace, sessionId);
  }

  /* ---- Message tracking ---- */

  async getMessages(workspace: string, sessionId: string): Promise<UIMessage[]> {
    return this.ensureCore().getMessages(workspace, sessionId);
  }

  async getTodos(workspace: string, sessionId: string): Promise<TodoItem[]> {
    return this.ensureCore().getTodos(workspace, sessionId);
  }

  async createSession(workspace: string): Promise<SessionSummary> {
    return this.ensureCore().createSession(workspace);
  }

  async listSessions(workspace: string): Promise<SessionSummary[]> {
    return this.ensureCore().listSessions(workspace);
  }

  async searchSessions(workspace: string, q: string): Promise<SessionSummary[]> {
    return this.ensureCore().searchSessions(workspace, q);
  }

  async updateSession(workspace: string, sessionId: string, updates: SessionUpdate): Promise<void> {
    return this.ensureCore().updateSession(workspace, sessionId, updates);
  }

  async deleteSession(workspace: string, sessionId: string): Promise<void> {
    return this.ensureCore().deleteSession(workspace, sessionId);
  }

  /* ---- Approval ---- */

  async listPendingApprovals(workspace: string, sessionId: string): Promise<ApprovalRequest[]> {
    return this.ensureCore().listPendingApprovals(workspace, sessionId);
  }

  async resolveApproval(workspace: string, sessionId: string, approvalId: string, decision: ApprovalDecision, rule?: Omit<Rule, 'source'>): Promise<boolean> {
    return this.ensureCore().resolveApproval(workspace, sessionId, approvalId, decision, rule);
  }

  /* ---- Broadcast stream ---- */

  stream(signal?: AbortSignal): AsyncIterable<BusEvent> {
    return this.ensureCore().stream(signal);
  }
}
