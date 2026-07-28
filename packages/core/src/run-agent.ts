import type { Message, Model, Usage, ThinkingLevel, Api } from '@earendil-works/pi-ai';
import { clampThinkingLevel } from '@earendil-works/pi-ai';
import type { UserInput, AgentOutput, AgentStream, AgentStreamEvent } from './types.js';
import type { PromptBuildContext } from './sdk/system-prompt.js';
import type { Skill } from './sdk/skill-provider.js';
import { EventBus } from './events.js';
import type { Session } from './session.js';
import type { LoopContext } from './sdk/loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ToolCall, ToolResult } from './sdk/tool-provider.js';
import { AgentEventStreamController } from './stream/agent-event-stream.js';
import type { AgentContext } from './agent-context.js';
import type { ArchiveRecord } from './sdk/storage-provider.js';
import { resolveContextWindow } from './llm/context-window.js';
import { generateId } from './shared/generate-id.js';
import { executeTools } from './execute/execute-tools.js';
import { AgentState } from './agent-state.js';
import { normalizeUsage, normalizeUsageDetail, type TokenUsageDetail } from './token-usage.js';
import { log } from './shared/debug-log.js';
import { OverlayToolProvider } from './overlay-tool-provider.js';
import { DefaultTodoService } from './todo/service.js';
import {
  createDelegateTaskToolDefinition,
  createDelegateTaskToolExecutor,
} from './plugins/tool/builtin/delegate-task.js';
import {
  createTodoWriteToolDefinition,
  createTodoWriteToolExecutor,
} from './plugins/tool/builtin/todo-write.js';

export interface RunAgentParams {
  input: UserInput;
  sessionId: string;
  signal?: AbortSignal;
  ctx: AgentContext;
  agentState: AgentState;
  workspace?: string;
  workspaceRoot?: string;
  agent?: string;
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentEventStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const ctx = params.ctx;
    const behavior = ctx.configProvider.getBehaviorConfig();
    const modelConfig = ctx.configProvider.getModelConfig();
    const agentRole = ctx.configProvider.resolveAgent(params.agent);
    const effectiveModel = agentRole.model ?? modelConfig;
    const workspace = params.workspace ?? 'default';
    const workspaceRoot = params.workspaceRoot ?? (params.workspace ? params.workspace : behavior.workspaceRoot);

    const sessionProvider = ctx.sessionProvider;
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

    if (!ctx.budgetPolicy.checkTurn(liveState) || !ctx.budgetPolicy.checkTimeout(Date.now())) {
      const output: AgentOutput = { content: 'Budget exceeded.', completed: true };
      controller.finish(output);
      return output;
    }

    const userMessage: Message = { role: 'user', content: params.input.content, timestamp: Date.now() } as Message;
    session.conversation.push(userMessage);
    await sessionProvider.save(session);

    forkTitleGeneration(session, ctx.titleProvider, controller, sessionProvider);

    try {
      const contextProvider = ctx.contextProvider;
      const compressor = ctx.compressor;
      const loopStrategy = ctx.loopStrategy;
      const toolProvider = ctx.toolProvider;
      const mcpProviders = ctx.mcpProviders;
      const skillProvider = ctx.skillProvider;
      const toolComposer = ctx.toolComposer;
      const errorHandler = ctx.errorHandler;
      const addMessage = (role: 'assistant' | 'tool') => sessionProvider.addMessage(session, role);
      const appendContent = (msg: Message, part: any) => sessionProvider.appendContent(session, msg, part);

      // 跟踪当前 assistant 消息的 messageId，用于把本次 usage 绑定到消息
      let currentMessageId: string | undefined;
      const trackMessageStart = (event: AgentStreamEvent) => {
        if (event.type === 'message-start') {
          currentMessageId = event.messageId;
        }
        controller.emit(event);
      };

      const { messages } = await contextProvider.build(session, behavior.name);

      let msgs = messages;
      if (compressor.shouldCompress(session)) {
        const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
          normalizeUsageDetail(entry as TokenUsageDetail),
        );
        const accumulated = history.reduce((sum: number, entry) => sum + entry.totalTokens, 0);
        const maxTokens = resolveContextWindow(effectiveModel.provider, effectiveModel.model, ctx.runtime.env, ctx.models);
        const compressionCfg = ctx.configProvider.getCompressionConfig();
        const threshold = maxTokens * compressionCfg.thresholdRatio;

        controller.emit({ type: 'compress-start', sessionId: params.sessionId, estimatedTokens: accumulated, threshold });

        const previousArchive = await ctx.storage.archiveStore.getLatest(params.sessionId);
        const version = previousArchive ? previousArchive.version + 1 : 1;
        const parentArchiveId = previousArchive?.id;

        const compressed = await compressor.compress(messages);
        const removedCount = messages.length - compressed.length;

        const archiveId = generateId();
        const summaryText = compressed
          .filter((m) => m.role === 'user')
          .flatMap((m) => (typeof m.content === 'string' ? [m.content] : m.content.filter((p: any) => p.type === 'text').map((p: any) => p.text)))
          .find((text: string) => text.includes('[上下文压缩摘要]')) ?? '';

        const archiveRecord: ArchiveRecord = {
          id: archiveId,
          sessionId: params.sessionId,
          compressedAt: new Date(),
          version,
          parentArchiveId,
          conversationSnapshot: messages,
          summary: summaryText,
          tokenUsageBefore: accumulated > 0 ? { totalTokens: accumulated, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } : undefined,
        };
        await ctx.storage.archiveStore.save(archiveRecord);

        session.conversation = compressed;
        session.metadata.compressionTokenOffset = accumulated;
        session.metadata.compressionHistory = [
          ...((session.metadata.compressionHistory as unknown[]) ?? []),
          { archiveId, version, compressedAt: new Date().toISOString(), removedMessageCount: removedCount },
        ];
        await sessionProvider.save(session);

        controller.emit({ type: 'compress-end', sessionId: params.sessionId, archiveId, removedMessageCount: removedCount });
        msgs = compressed;
      }

      const effectiveToolProvider = toolComposer.compose({
        toolProvider,
        mcpProviders,
        skillProvider,
      });

      const toolProviderWithDelegate = new OverlayToolProvider(effectiveToolProvider);
      const delegateToolDefinition = createDelegateTaskToolDefinition();
      const delegateToolExecutor = createDelegateTaskToolExecutor(ctx, params.agentState, workspace);
      toolProviderWithDelegate.register(delegateToolDefinition, delegateToolExecutor);

      const todoWriteDefinition = createTodoWriteToolDefinition();
      const todoWriteExecutor = createTodoWriteToolExecutor(
        new DefaultTodoService(ctx.storage.todoStore),
        (event) => params.agentState.publish(event),
        workspace,
      );
      toolProviderWithDelegate.register(todoWriteDefinition, todoWriteExecutor);

      const piTools = toolProviderWithDelegate.getToolSet();
      const tools = piTools.map((t) => ({ name: t.name, description: t.description }));

      const skills = await skillProvider.loadSkills().catch(() => [] as Skill[]);

      const buildCtx: PromptBuildContext = {
        agentName: agentRole.name,
        workspaceRoot,
        readOnly: behavior.readOnly,
        tools,
        skills,
        model: { provider: effectiveModel.provider, model: effectiveModel.model },
        runtime: {
          platform: ctx.runtime.platform,
          nodeVersion: ctx.runtime.nodeVersion ?? ctx.runtime.platform,
          today: new Date().toISOString().split('T')[0],
          cwd: ctx.runtime.cwd,
        },
        agentCorePrompt: agentRole.corePrompt,
      };

      const systemPrompt = await ctx.systemPromptAssembler.assemble(buildCtx);
      const contextForModel = () => ({
        systemPrompt,
        messages: msgs,
        tools: piTools,
      });

      const loopCtx: LoopContext = {
        liveState,
        messages: msgs,
        addMessage,
        appendContent,
        system: systemPrompt,
        stream: () => {
          const model = ctx.models.getModel(effectiveModel.provider, effectiveModel.model);
          if (!model) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);
          return ctx.models.stream(model, contextForModel(), {
            thinkingEnabled: true,
            apiKey: effectiveModel.apiKey || undefined,
            baseURL: effectiveModel.baseURL || undefined,
            signal: params.signal,
            maxRetries: 0,
          });
        },
        generate: () => {
          const model = ctx.models.getModel(effectiveModel.provider, effectiveModel.model);
          if (!model) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);
          return ctx.models.complete(model, contextForModel(), {
            thinkingEnabled: true,
            apiKey: effectiveModel.apiKey || undefined,
            baseURL: effectiveModel.baseURL || undefined,
            signal: params.signal,
            maxRetries: 0,
          });
        },
        execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
          toolCalls: calls,
          toolProvider: toolProviderWithDelegate,
          messages: msgs,
          agentState: params.agentState,
          permissionEvaluator: ctx.permissionEvaluator,
          ruleEngine: ctx.ruleEngine,
          ruleStore: ctx.storage.ruleStore,
          securityMode: ctx.securityMode,
          workspaceRoot,
          agentName: behavior.name,
          readOnly: behavior.readOnly,
          sessionId: params.sessionId,
          signal: params.signal,
          emit: (event) => trackMessageStart(event),
        }),
        emit: (event) => trackMessageStart(event),
        signal: params.signal,
        maxSteps: behavior.maxTurns,
        workspaceRoot,
        readOnly: behavior.readOnly,
        agentName: behavior.name,
        sessionId: params.sessionId,
      };

      const result = await loopStrategy.run(loopCtx);
      const usage = result.usage;

      // 累加 token usage，发布事件，持久化明细
      liveState.addTokenUsage(usage);
      params.agentState.publishUsageChange(workspace, params.sessionId, liveState.tokenUsage);

      const history = ((session.metadata.tokenUsageHistory as unknown[]) ?? []).map((entry) =>
        normalizeUsageDetail(entry as TokenUsageDetail),
      );
      history.push({
        ...usage,
        runAt: new Date(),
        turns: [usage],
      });
      session.metadata.tokenUsageHistory = history;

      // 把本次 usage 绑定到当前 assistant 消息
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

      const output: AgentOutput = { content: result.content, completed: true };
      controller.finish(output, result.message);
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
      /* best-effort */
      log('title', 'failed', { sessionId: session.sessionId });
    }
  })();
}
