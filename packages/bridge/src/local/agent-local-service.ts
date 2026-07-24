import {
  AgentState, assembleAgentContext, createCoreModels,
  DefaultSystemPromptAssembler, ProviderAwareTemplateSelector,
  ClaudeAgentPromptTemplate, OpenAiAgentPromptTemplate,
  ToolingSection, ExecutionBiasSection, SafetySection, AgentsMdSection,
  SkillsSection, WorkspaceSection, RuntimeSection,
  StaticToolProvider, EmptySkillProvider,
} from 'rem-agent-core/browser';
import type {
  AgentContext, AgentInstructionLoader, CustomTool,
} from 'rem-agent-core/browser';
import type { ApprovalDecision, ApprovalRequest, Rule, TodoItem, UserInputContent } from 'rem-agent-core/browser';
import { ServiceError } from '../errors.js';
import type { BusEvent, SessionSummary, SessionUpdate, UIMessage, Workspace } from '../types.js';
import type { IAgentService } from '../agent-service.interface.js';
import { AgentSessionManager } from '../agent-session.js';
import { AgentServiceCore } from '../agent-service-core.js';
import { IndexedDBStorageProvider } from './idb-storage-provider.js';
import { BrowserSessionProvider } from './browser-session-provider.js';
import { StaticConfigProvider } from './static-config-provider.js';
import { NoopCompressor } from './noop-compressor.js';
import { IdbWorkspaceRepository } from './idb-workspace-repository.js';
import type { ProviderCredential } from './credential-store.js';

export interface LocalAgentServiceOptions {
  credential: ProviderCredential;
  tools?: CustomTool[];
  maxTurns?: number;
  name?: string;
  dbName?: string;
}

const noopInstructionLoader: AgentInstructionLoader = {
  load: async () => undefined,
};

/** 浏览器内运行的 AgentService：IndexedDB 存储、空工具集（可注入自定义工具）、凭据直连 provider。 */
export class LocalAgentService implements IAgentService {
  private core: AgentServiceCore | undefined;

  constructor(private options: LocalAgentServiceOptions) {}

  async init(): Promise<void> {
    const { credential } = this.options;
    const configProvider = new StaticConfigProvider({
      provider: credential.provider,
      model: credential.model ?? '',
      apiKey: credential.apiKey,
      baseURL: credential.baseURL,
      name: this.options.name,
      maxTurns: this.options.maxTurns,
    });

    const storageProvider = new IndexedDBStorageProvider(this.options.dbName ?? 'rem-agent');
    await storageProvider.init();

    const models = createCoreModels({ all: true });

    const skillProvider = new EmptySkillProvider();
    const systemPromptAssembler = new DefaultSystemPromptAssembler(
      new ProviderAwareTemplateSelector(
        new ClaudeAgentPromptTemplate(),
        { openai: new OpenAiAgentPromptTemplate() },
      ),
      [
        new ToolingSection(),
        new ExecutionBiasSection(),
        new SafetySection(),
        new AgentsMdSection(noopInstructionLoader),
        new SkillsSection(skillProvider),
        new WorkspaceSection(),
        new RuntimeSection(),
      ],
    );

    const ctx: AgentContext = await assembleAgentContext({
      configProvider,
      sessionProvider: new BrowserSessionProvider(storageProvider.sessionStore),
      storageProvider,
      systemPromptAssembler,
      models,
      runtime: { platform: 'web', cwd: '/', env: {} },
      toolProvider: new StaticToolProvider(this.options.tools ?? []),
      skillProvider,
      compressor: new NoopCompressor(),
      securityMode: 'auto',
    });

    const agentState = new AgentState();
    this.core = new AgentServiceCore({
      ctx,
      agentState,
      sessionManager: new AgentSessionManager(ctx.sessionProvider, agentState),
      workspaceRepository: new IdbWorkspaceRepository(storageProvider.workspaceStore),
    });
  }

  private ensureCore(): AgentServiceCore {
    if (!this.core) {
      throw new ServiceError('LocalAgentService not initialized', 503);
    }
    return this.core;
  }

  /* ---- Workspace management ---- */

  async listWorkspaces(): Promise<Workspace[]> {
    return this.ensureCore().listWorkspaces();
  }

  async addWorkspace(path: string): Promise<Workspace> {
    return this.ensureCore().addWorkspace(path);
  }

  async removeWorkspace(path: string): Promise<void> {
    return this.ensureCore().removeWorkspace(path);
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
