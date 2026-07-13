import type { UserInput, AgentOutput, AgentStream, ModelMessage, ProviderChunk } from './types.js';
import type { PromptBuildContext } from './sdk/system-prompt.js';
import type { Skill } from './sdk/skill-provider.js';
import { EventBus } from './events.js';
import type { Session } from './session.js';
import type { LoopContext } from './sdk/loop-strategy.js';
import type { SessionProvider } from './sdk/session-provider.js';
import type { TitleProvider } from './sdk/title-provider.js';
import type { ToolCall, ToolResult } from './sdk/tool-provider.js';
import { AgentStreamController } from './stream/agent-stream.js';
import type { AgentContext } from './agent-context.js';
import { generateId } from './shared/generate-id.js';
import { reason } from './reason/reason.js';
import { executeTools } from './execute/execute-tools.js';
import { AgentState } from './agent-state.js';
import type { TokenUsageDetail } from './token-usage.js';
import { log } from './shared/debug-log.js';
import { OverlayToolProvider } from './overlay-tool-provider.js';
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
}

export interface RunAgentResult {
  stream: AgentStream;
  output: Promise<AgentOutput>;
}

export function runAgent(params: RunAgentParams): RunAgentResult {
  const controller = new AgentStreamController();
  const stream = controller.stream;

  const outputPromise = (async (): Promise<AgentOutput> => {
    const ctx = params.ctx;
    const behavior = ctx.configProvider.getBehaviorConfig();
    const modelConfig = ctx.configProvider.getModelConfig();
    const workspace = params.workspace ?? 'default';
    const workspaceRoot = params.workspaceRoot ?? (params.workspace ? params.workspace : behavior.workspaceRoot);

    const sessionProvider = ctx.sessionProvider;
    let session = await sessionProvider.load(params.sessionId);
    if (!session) {
      session = {
        sessionId: params.sessionId, conversation: [], currentTurn: 0, metadata: {},
        createdAt: new Date(), updatedAt: new Date(),
      };
      await sessionProvider.save(session);
    }

    const events = new EventBus();
    const liveState = params.agentState.getOrCreate(params.sessionId);
    liveState.attachEvents(events);

    // 恢复累计 token usage（如果运行时状态为空）
    if (liveState.tokenUsage.totalTokens === 0) {
      const history = (session.metadata.tokenUsageHistory ?? []) as TokenUsageDetail[];
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

    session.conversation.push({
      id: generateId(), role: 'user',
      content: [{ type: 'text', text: params.input.content }],
    } as ModelMessage);
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
      const appendContent = (msg: ModelMessage, part: any) => sessionProvider.appendContent(session, msg, part);

      // 跟踪当前 assistant 消息的 messageId，用于把本次 usage 绑定到消息
      let currentMessageId: string | undefined;
      const trackMessageStart = (chunk: ProviderChunk) => {
        if (chunk.type === 'message-start') {
          currentMessageId = chunk.messageId;
        }
        controller.emit(chunk);
      };

      const { messages } = await contextProvider.build(session, behavior.name);

      let msgs = compressor.shouldCompress(session) ? await compressor.compress(messages) : messages;

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
        ctx.todoService,
        (event) => params.agentState.publish(event),
        workspace,
      );
      toolProviderWithDelegate.register(todoWriteDefinition, todoWriteExecutor);

      const toolSet = toolProviderWithDelegate.getToolSet();
      const tools = Object.entries(toolSet).map(([name, schema]) => ({
        name,
        description: schema.description,
      }));

      const skills = await skillProvider.loadSkills().catch(() => [] as Skill[]);

      const buildCtx: PromptBuildContext = {
        agentName: behavior.name,
        workspaceRoot,
        readOnly: behavior.readOnly,
        tools,
        skills,
        model: { provider: modelConfig.provider, model: modelConfig.model },
        runtime: {
          platform: process.platform,
          nodeVersion: process.version,
          today: new Date().toISOString().split('T')[0],
          cwd: process.cwd(),
        },
      };

      const systemPrompt = await ctx.systemPromptAssembler.assemble(buildCtx);

      const loopCtx: LoopContext = {
        liveState,
        messages: msgs,
        addMessage,
        appendContent,
        system: systemPrompt,
        reason: () => reason(
          {
            provider: modelConfig.provider, model: modelConfig.model, apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseURL, system: systemPrompt, messages: msgs,
            tools: toolProviderWithDelegate.getToolSet(), signal: params.signal, errorHandler,
          },
          (chunk) => trackMessageStart(chunk),
        ),
        execute: (calls: ToolCall[]): Promise<ToolResult[]> => executeTools({
          toolCalls: calls, toolProvider: toolProviderWithDelegate, addMessage, appendContent,
          agentState: params.agentState,
          permissionEvaluator: ctx.permissionEvaluator,
          ruleEngine: ctx.ruleEngine,
          ruleStore: ctx.ruleStore,
          securityMode: ctx.securityMode,
          workspaceRoot, agentName: behavior.name,
          readOnly: behavior.readOnly, sessionId: params.sessionId, signal: params.signal,
          emit: (chunk) => trackMessageStart(chunk),
        }),
        emit: (chunk) => trackMessageStart(chunk),
        signal: params.signal, maxSteps: behavior.maxTurns,
        workspaceRoot, readOnly: behavior.readOnly,
        agentName: behavior.name, sessionId: params.sessionId,
      };

      const result = await loopStrategy.run(loopCtx);

      // 累加 token usage，发布事件，持久化明细
      liveState.addTokenUsage(result.usage);
      params.agentState.publishUsageChange(workspace, params.sessionId, liveState.tokenUsage);

      const history = (session.metadata.tokenUsageHistory ?? []) as TokenUsageDetail[];
      history.push({
        ...result.usage,
        runAt: new Date(),
        turns: [result.usage],
      });
      session.metadata.tokenUsageHistory = history;

      // 把本次 usage 绑定到当前 assistant 消息
      if (currentMessageId) {
        const messageTokenUsage = (session.metadata.messageTokenUsage ?? {}) as Record<string, import('./types.js').LanguageModelUsage>;
        messageTokenUsage[currentMessageId] = result.usage;
        session.metadata.messageTokenUsage = messageTokenUsage;
      }

      session.currentTurn++;
      await sessionProvider.save(session);

      const output: AgentOutput = { content: result.content, completed: true };
      controller.finish(output);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
  controller: AgentStreamController,
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
