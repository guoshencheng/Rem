import type { AgentDI } from '../agent-di.js';
import type { AgentRuntimeConfig } from '../agent-runtime-config.js';
import type { BusEvent } from '../agent/bus-events.js';
import type { Session } from '../session/model.js';
import type { AgentStreamEvent, RemMetaEvent } from '../agent/types.js';
import type { ArchiveRecord } from '../sdk/storage-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import { normalizeUsageDetail, type TokenUsageDetail } from '../agent/token-usage.js';
import { generateId } from '../shared/generate-id.js';
import { resolveContextWindow } from '../infrastructure/llm/context-window.js';
import { composeToolProviders } from '../tools/composer.js';
import { ToolOverlay, defineOverlayTool } from '../tools/overlay.js';
import { createToolBridge } from './tool-bridge.js';
import { createContextBridge } from './context-bridge.js';
import { createPiAgent } from './pi-agent-factory.js';
import { DefaultTodoService } from '../capabilities/todo/service.js';
import { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from '../plugins/tool/builtin/todo-write.js';
import type { PiAgentLike } from './pi-agent-like.js';
import type { REMAgentContext } from '../agent-context.js';
import type { ApprovalStateLike, REMAgent } from '../rem-agent.js';
import { createDelegateTaskExecutor, createDelegateTaskToolDefinition, type SpawnChild } from '../capabilities/sub-agent/delegate-task.js';

export interface AssemblePiAgentParams {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  /** 预解析产物（resolveREMAgentContext） */
  context: REMAgentContext;
  sessionId: string;
  workspace: string;
  signal?: AbortSignal;
  /** 审批状态（REMSession 适配） */
  approvalState: { getOrCreate(sessionId: string): ApprovalStateLike };
  /** BusEvent 出口（todo_write 等工具直发总线） */
  publishBus: (event: BusEvent) => void;
  /** delegate_task 能力；缺省时 delegate_task 调用直接返回 failed 结果 */
  spawnChild?: SpawnChild;
  /** delegate_task 挂树的父 Agent */
  parent: REMAgent;
  /** meta 事件出口（tool-bridge / context-bridge） */
  emitMeta: (event: RemMetaEvent) => void;
  /** 压缩判定用的 session（本函数不做任何持久化） */
  session: Session;
}

/** REMAgent 内部装配（全同步）：工具组合 → bridges → createPiAgent */
export function assemblePiAgent(params: AssemblePiAgentParams): PiAgentLike {
  const { di, runtimeConfig, context, workspace, session } = params;
  const { behavior, configProvider, effectiveModel, workspaceRoot } = context;

  const effectiveToolProvider = composeToolProviders({
    toolProvider: di.toolProvider,
    mcpProviders: di.mcpProviders,
    skillProvider: di.skillProvider,
  });

  const spawnChild: SpawnChild =
    params.spawnChild ??
    (async () => {
      throw new Error('delegate_task is not available for this agent');
    });

  const toolProviderWithOverlay: ToolProvider = new ToolOverlay(effectiveToolProvider, [
    defineOverlayTool(
      createDelegateTaskToolDefinition(),
      createDelegateTaskExecutor({
        parentAgent: () => params.parent,
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

  // tool-bridge / context-bridge 只发 RemMetaEvent；签名按 AgentStreamEvent 收窄到 emitMeta
  const emit = (event: AgentStreamEvent) => params.emitMeta(event as RemMetaEvent);

  const toolBridge = createToolBridge({
    toolProvider: toolProviderWithOverlay,
    permissionEvaluator: di.permissionEvaluator,
    agentState: params.approvalState,
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

  return createPiAgent({
    di,
    effectiveModel,
    systemPrompt: context.systemPrompt,
    messages: context.messages,
    tools: toolBridge.tools,
    beforeToolCall: (ctx) => toolBridge.beforeToolCall(ctx),
    transformContext: contextBridge.transformContext,
    maxTurns: behavior.maxTurns,
    signal: params.signal,
  });
}
