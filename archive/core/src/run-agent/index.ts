import type { Message, Usage, AssistantMessage } from '@earendil-works/pi-ai';
import type { Agent } from '@earendil-works/pi-agent-core';
import type { UserInput, UserInputContent, AgentOutput, AgentStream, AgentStreamEvent } from '../types.js';
import type { PromptBuildContext } from '../sdk/system-prompt.js';
import type { Skill } from '../sdk/skill-provider.js';
import { EventBus } from '../events.js';
import type { Session } from '../session.js';
import type { SessionProvider } from '../sdk/session-provider.js';
import type { ToolProvider } from '../sdk/tool-provider.js';
import type { TitleProvider } from '../sdk/title-provider.js';
import { AgentEventStreamController } from '../stream/agent-event-stream.js';
import type { AgentDI } from '../agent-di.js';
import { composeToolProviders } from '../tool-composer.js';
import type { AgentRuntimeConfig } from '../agent-runtime-config.js';
import type { ArchiveRecord } from '../sdk/storage-provider.js';
import { resolveContextWindow } from '../llm/context-window.js';
import { generateId } from '../shared/generate-id.js';
import type { AgentState } from '../agent-state.js';
import { normalizeUsage, normalizeUsageDetail, type TokenUsageDetail } from '../token-usage.js';
import { log } from '../shared/debug-log.js';
import { ToolOverlay, defineOverlayTool } from '../tool-overlay.js';
import { DefaultTodoService } from '../todo/service.js';
import {
  createDelegateTaskToolDefinition,
  createDelegateTaskToolExecutor,
} from '../plugins/tool/builtin/delegate-task.js';
import {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from '../plugins/tool/builtin/todo-write.js';
import { createToolBridge } from './tool-bridge.js';
import { createSessionHelper } from '../utils/session-writer.js';
import { createContextBridge } from './context-bridge.js';
import { createPiAgent } from './pi-agent-factory.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  agentState: AgentState;
  workspace?: string;
  workspaceRoot?: string;
  agent?: string;
}

export interface RunAgentHandle {
  steer: (content: UserInputContent) => void;
  followUp: (content: UserInputContent) => void;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentEventStreamController();
  const stream = controller.stream;

  const toMessage = (content: UserInputContent): Message => ({ role: 'user', content, timestamp: Date.now() }) as Message;
  const outputPromise = (async (): Promise<AgentOutput> => {
    const di = params.di;
    const runtimeConfig = params.runtimeConfig;
    const workspace = params.workspace ?? 'default';
    const configProvider = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
    const behavior = configProvider.getBehaviorConfig();
    const modelConfig = configProvider.getModelConfig();
    const agentRole = configProvider.resolveAgent(params.agent);
    const effectiveModel = agentRole.model ?? modelConfig;
    const workspaceRoot = params.workspaceRoot ?? (params.workspace ? params.workspace : behavior.workspaceRoot);

    const sessionProvider = di.sessionProvider;
    let session = await sessionProvider.load(params.sessionId);
    if (!session) {
      session = {
        sessionId: params.sessionId, conversation: [], currentTurn: 0, metadata: { schemaVersion: 2 },
        createdAt: new Date(), updatedAt: new Date(),
      };
      await sessionProvider.save(session);
    }

    const events = new EventBus();
    const liveState = params.agentState.getOrCreate(params.sessionId);
    liveState.attachEvents(events);

    // 恢复累计 token usage（如果运行时状态为空）
    if (liveState.tokenUsage.totalTokens === 0) {
      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
        normalizeUsageDetail(entry as TokenUsageDetail),
      );
      if (history.length > 0) {
        params.agentState.restoreTokenUsage(params.sessionId, history);
      }
    }

    // AgentService 已通过 startRun 将状态置为 running；直接调用 runAgent 时在这里启动
    if (liveState.status !== 'running') {
      liveState.start({ clearSnapshot: true });
    }

    if (!di.budgetPolicy.checkTurn(liveState) || !di.budgetPolicy.checkTimeout(Date.now())) {
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      return output;
    }

    forkTitleGeneration(session, di.titleProvider, controller, sessionProvider);

    try {
      const { messages } = await di.contextProvider.build(session, behavior.name);

      const effectiveToolProvider = composeToolProviders({
        toolProvider: di.toolProvider,
        mcpProviders: di.mcpProviders,
        skillProvider: di.skillProvider,
      });

      const toolProviderWithDelegate: ToolProvider = new ToolOverlay(effectiveToolProvider, [
        defineOverlayTool(
          createDelegateTaskToolDefinition(),
          createDelegateTaskToolExecutor(di, runtimeConfig, params.agentState, workspace),
        ),
        defineOverlayTool(
          createTodoWriteToolDefinition(),
          createTodoWriteToolExecutor(
            new DefaultTodoService(di.storage.todoStore),
            (event) => params.agentState.publish(event),
            workspace,
          ),
        ),
      ]);

      const skills = await di.skillProvider.loadSkills().catch(() => [] as Skill[]);
      const tools = toolProviderWithDelegate.getToolSet().map((t) => ({ name: t.name, description: t.description }));

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

      const emit = (event: AgentStreamEvent) => controller.emit(event);

      const toolBridge = createToolBridge({
        toolProvider: toolProviderWithDelegate,
        permissionEvaluator: di.permissionEvaluator,
        agentState: params.agentState,
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
        shouldCompress: (msgs) => di.compressor.shouldCompress({ ...session!, conversation: msgs }),
        estimatedTokens: () => accumulated,
        threshold: () => {
          const maxTokens = resolveContextWindow(effectiveModel.provider, effectiveModel.model, runtimeConfig.runtime.env, di.models);
          return maxTokens * configProvider.getCompressionConfig().thresholdRatio;
        },
        archive: async (before, after) => {
          const previousArchive = await di.storage.archiveStore.getLatest(params.sessionId);
          const archiveId = generateId();
          const summaryText = after
            .filter((m) => m.role === 'user')
            .flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text)))
            .find((text) => text.includes('[上下文压缩摘要]')) ?? '';
          const record: ArchiveRecord = {
            id: archiveId,
            sessionId: params.sessionId,
            compressedAt: new Date(),
            version: previousArchive ? previousArchive.version + 1 : 1,
            parentArchiveId: previousArchive?.id,
            conversationSnapshot: before,
            summary: summaryText,
            tokenUsageBefore: accumulated > 0 ? { totalTokens: accumulated, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } : undefined,
          };
          await di.storage.archiveStore.save(record);
          session!.metadata.compressionHistory = [
            ...((session!.metadata.compressionHistory as unknown[]) ?? []),
            { archiveId, version: record.version, compressedAt: new Date().toISOString(), removedMessageCount: before.length - after.length },
          ];
          await sessionProvider.save(session!);
          return archiveId;
        },
        emit,
        sessionId: params.sessionId,
      });

      const agent = createPiAgent({
        di,
        effectiveModel,
        systemPrompt,
        messages,
        tools: toolBridge.tools,
        beforeToolCall: (ctx) => toolBridge.beforeToolCall(ctx),
        transformContext: contextBridge.transformContext,
        maxTurns: behavior.maxTurns,
        signal: params.signal,
      });

      const sessionHelper = createSessionHelper({ sessionProvider, session });
      agent.subscribe(sessionHelper.listener);
      agent.subscribe(controller.emit.bind(controller));

      await agent.prompt(toMessage(params.input.content));

      const finalMessage: AssistantMessage | undefined = sessionHelper.getLastAssistantMessage();
      if (finalMessage?.stopReason === 'error') {
        const errorMessage = finalMessage.errorMessage ?? 'agent stream error';
        const output: AgentOutput = { content: `Error: ${errorMessage}`, completed: true };
        controller.fail(new Error(errorMessage));
        params.agentState.publishSessionError(workspace, params.sessionId, errorMessage);
        await sessionProvider.save(session);
        return output;
      }

      const usage = sessionHelper.getTotalUsage();
      liveState.addTokenUsage(usage);
      params.agentState.publishUsageChange(workspace, params.sessionId, liveState.tokenUsage);

      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
        normalizeUsageDetail(entry as TokenUsageDetail));
      history.push({
        ...usage,
        runAt: new Date(),
        turns: [usage],
      });
      session.metadata.tokenUsageHistory = history;

      const currentMessageId = sessionHelper.getLastAssistantMessageId();
      if (currentMessageId) {
        const messageTokenUsage: Record<string, Usage> = {};
        for (const [key, value] of Object.entries(session.metadata.messageTokenUsage ?? {})) {
          messageTokenUsage[key] = normalizeUsage(value as Usage);
        }
        messageTokenUsage[currentMessageId] = usage;
        session.metadata.messageTokenUsage = messageTokenUsage;
      }

      session.currentTurn++;
      await sessionProvider.save(session);

      const content = finalMessage?.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('') ?? '';
      const output: AgentOutput = { content, completed: true };
      controller.finish(output, finalMessage);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('compress') || message.includes('summary')) {
        controller.emit({ type: 'compress-error', sessionId: params.sessionId, error: message });
      }
      const output: AgentOutput = { content: `Error: ${message}`, completed: true };
      controller.fail(error instanceof Error ? error : new Error(message));
      params.agentState.publishSessionError(workspace, params.sessionId, message);
      await sessionProvider.save(session);
      return output;
    }
  })();

  return { stream, output: outputPromise };
}

function forkTitleGeneration(
  session: Session,
  titleProvider: TitleProvider,
  controller: AgentEventStreamController,
  sessionProvider: SessionProvider,
): void {
  if (session.metadata.title) return;
  (async () => {
    try {
      const title = await titleProvider.generateTitle(session.conversation);
      if (title) {
        log('title', 'generated', { sessionId: session.sessionId, title });
        session.metadata.title = title;
        controller.pushTitle(title);
        await sessionProvider.save(session);
      }
    } catch {
      log('title', 'failed', { sessionId: session.sessionId });
    }
  })();
}
