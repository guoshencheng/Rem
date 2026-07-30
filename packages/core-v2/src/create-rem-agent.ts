import type { Message } from '@earendil-works/pi-ai';
import type {
  AgentDI, AgentRuntimeConfig, AgentStreamEvent, ArchiveRecord, BusEvent, Session,
  PromptBuildContext, RemMetaEvent, Skill, TokenUsageDetail, ToolProvider,
  ApprovalEngine, ApprovalRequest,
} from 'rem-agent-core';
import {
  DefaultTodoService, ToolOverlay, composeToolProviders,
  createContextBridge, createPiAgent, createTodoWriteToolDefinition,
  createTodoWriteToolExecutor, createToolBridge, defineOverlayTool, generateId,
  log, normalizeUsageDetail, resolveContextWindow,
} from 'rem-agent-core';
import { REMAgent } from './rem-agent.js';
import { createDelegateTaskExecutorV2, createDelegateTaskToolDefinitionV2, type SpawnChild } from './delegate-task-v2.js';

/** tool-bridge 审批链路需要的最小 live state 面（由 bridge 的 REMSession 满足） */
export interface ApprovalStateLike {
  approvalEngine: ApprovalEngine;
  pendingApprovals: ApprovalRequest[];
}

export interface CreateREMAgentParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  /** 已由 SessionService 加载/创建的 session（本函数不做任何持久化） */
  session: Session;
  workspace: string;
  agentId: string;
  sessionId: string;
  agentRoleId?: string;
  workspaceRoot?: string;
  signal?: AbortSignal;
  summary?: string;
  /** 审批状态（REMSession 适配） */
  approvalState: { getOrCreate(sessionId: string): ApprovalStateLike };
  /** BusEvent 出口（todo_write 等工具直发总线） */
  publishBus: (event: BusEvent) => void;
  /** delegate_task 能力；缺省时 delegate_task 调用直接返回 failed 结果 */
  spawnChild?: SpawnChild;
}

export async function createREMAgent(params: CreateREMAgentParams): Promise<REMAgent> {
  const { di, runtimeConfig, session, workspace } = params;
  const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
  const behavior = configProvider.getBehaviorConfig();
  const modelConfig = configProvider.getModelConfig();
  const agentRole = configProvider.resolveAgent(params.agentRoleId);
  const effectiveModel = agentRole.model ?? modelConfig;
  const workspaceRoot = params.workspaceRoot ?? workspace ?? behavior.workspaceRoot;

  const { messages } = await di.contextProvider.build(session, behavior.name);

  const effectiveToolProvider = composeToolProviders({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });

  // 两个延迟引用：emitMeta 与 parentAgent 都在 REMAgent 构造后回填
  let emitMeta: (event: RemMetaEvent) => void = () => {};
  const parentRef: { current?: REMAgent } = {};

  const spawnChild: SpawnChild =
    params.spawnChild ??
    (async () => {
      throw new Error('delegate_task is not available for this agent');
    });

  const toolProviderWithOverlay: ToolProvider = new ToolOverlay(effectiveToolProvider, [
    defineOverlayTool(
      createDelegateTaskToolDefinitionV2(),
      createDelegateTaskExecutorV2({
        parentAgent: () => {
          if (!parentRef.current) throw new Error('delegate_task called before agent is ready');
          return parentRef.current;
        },
        spawnChild,
      }),
    ),
    defineOverlayTool(
      createTodoWriteToolDefinition(),
      createTodoWriteToolExecutor(
        new DefaultTodoService(di.storage.todoStore),
        (event) => params.publishBus(event),
        workspace,
      ),
    ),
  ]);

  const skills = await di.skillProvider.loadSkills().catch(() => [] as Skill[]);
  const tools = toolProviderWithOverlay.getToolSet().map((t) => ({ name: t.name, description: t.description }));

  const buildCtx: PromptBuildContext = {
    agentName: agentRole.name,
    workspaceRoot,
    readOnly: behavior.readOnly,
    tools,
    skills,
    model: { provider: effectiveModel.provider, model: effectiveModel.model },
    runtime: {
      platform: runtimeConfig.runtime.platform,
      nodeVersion: runtimeConfig.runtime.nodeVersion ?? runtimeConfig.runtime.platform,
      today: new Date().toISOString().split('T')[0],
    },
    agentCorePrompt: agentRole.corePrompt,
  };

  const systemPrompt = await di.systemPromptAssembler.assemble(buildCtx);

  // tool-bridge / context-bridge 只发 RemMetaEvent；签名按 AgentStreamEvent 收窄到 emitMeta
  const emit = (event: AgentStreamEvent) => emitMeta(event as RemMetaEvent);

  const toolBridge = createToolBridge({
    toolProvider: toolProviderWithOverlay,
    permissionEvaluator: di.permissionEvaluator,
    agentState: params.approvalState as never, // 结构适配：仅用 getOrCreate → approvalEngine/pendingApprovals
    ruleEngine: di.ruleEngine,
    ruleStore: di.storage.ruleStore,
    securityMode: runtimeConfig.securityMode,
    workspaceRoot,
    agentName: behavior.name,
    readOnly: behavior.readOnly,
    sessionId: params.sessionId,
    signal: params.signal,
    emit,
  });

  const historyForTokens = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
    normalizeUsageDetail(entry as TokenUsageDetail));
  const accumulated = historyForTokens.reduce((sum, entry) => sum + entry.totalTokens, 0);

  const contextBridge = createContextBridge({
    compressor: di.compressor,
    shouldCompress: (msgs) => di.compressor.shouldCompress({ ...session, conversation: msgs }),
    estimatedTokens: () => accumulated,
    threshold: () => {
      const maxTokens = resolveContextWindow(effectiveModel.provider, effectiveModel.model, runtimeConfig.runtime.env, di.models);
      return maxTokens * configProvider.getCompressionConfig().thresholdRatio;
    },
    archive: async (before, _after) => {
      // v2：只写 archiveStore；session.metadata.compressionHistory 由 SessionService
      // 在 compress-end 事件时更新（单一写入方）
      const previousArchive = await di.storage.archiveStore.getLatest(params.sessionId);
      const archiveId = generateId();
      const record: ArchiveRecord = {
        id: archiveId,
        sessionId: params.sessionId,
        compressedAt: new Date(),
        version: previousArchive ? previousArchive.version + 1 : 1,
        parentArchiveId: previousArchive?.id,
        conversationSnapshot: before,
        summary: '',
      };
      await di.storage.archiveStore.save(record);
      return archiveId;
    },
    emit,
    sessionId: params.sessionId,
  });

  const piAgent = createPiAgent({
    di,
    effectiveModel,
    systemPrompt,
    messages: messages as Message[],
    tools: toolBridge.tools,
    beforeToolCall: (ctx) => toolBridge.beforeToolCall(ctx),
    transformContext: contextBridge.transformContext,
    maxTurns: behavior.maxTurns,
    signal: params.signal,
  });

  const remAgent = new REMAgent({
    agentId: params.agentId,
    agent: piAgent,
    sessionId: params.sessionId,
    summary: params.summary,
  });
  emitMeta = (event) => remAgent.emitMeta(event);
  parentRef.current = remAgent;

  // 标题生成（原 forkTitleGeneration）：发事件，由 SessionService 落盘
  if (!session.metadata.title) {
    void (async () => {
      try {
        const title = await di.titleProvider.generateTitle(session.conversation);
        if (title) {
          log('title', 'generated', { sessionId: session.sessionId, title });
          remAgent.emitMeta({ type: 'session-title', title });
        }
      } catch {
        log('title', 'failed', { sessionId: session.sessionId });
      }
    })();
  }

  return remAgent;
}
