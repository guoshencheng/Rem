import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApprovalDecision, ApprovalRequest, AgentContext, Rule, TodoItem, UserInputContent } from 'rem-agent-core';
import { buildAgentContext, AgentState } from 'rem-agent-core';
import type { AgentContextBuildOptions } from 'rem-agent-core';
import { ServiceError } from './errors.js';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from './types.js';
import type { IAgentService } from './agent-service.interface.js';
import { AgentServiceCore } from './agent-service-core.js';

export type AgentServiceOptions = AgentContextBuildOptions;

export class AgentService implements IAgentService {
  private options: AgentServiceOptions;
  private ctx: AgentContext | undefined;
  private agentState = new AgentState();
  private core: AgentServiceCore | undefined;
  private initialized = false;

  constructor(options: AgentServiceOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    this.ctx = await buildAgentContext(this.options);
    this.core = new AgentServiceCore({
      ctx: this.ctx,
      agentState: this.agentState,
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
    return this.ensureCore().listWorkspaces();
  }

  async addWorkspace(rawPath: string): Promise<Workspace> {
    return this.ensureCore().addWorkspace(await this.resolveWorkspaceDir(rawPath));
  }

  async removeWorkspace(rawPath: string): Promise<void> {
    return this.ensureCore().removeWorkspace(path.resolve(rawPath));
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
