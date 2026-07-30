import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import { runAgentLoop, runAgentLoopContinue } from '@earendil-works/pi-agent-core';
import type { AgentContext, AgentEvent, AgentLoopConfig, StreamFn } from '@earendil-works/pi-agent-core';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { Session } from '../session/model.js';
import type { AgentOutput, AgentStreamEvent, RemMetaEvent, UserInput, UserInputContent } from './types.js';
import type { REMAgentEvent } from './agent-event.js';
import { resolveAgentConfig } from './context/resolve-config.js';
import { resolveSystemPrompt } from './context/resolve-system-prompt.js';
import { PendingMessageQueue } from '../runtime/pending-queue.js';
import { createAgentTools } from '../runtime/agent-tools.js';
import { createCompressionTransform } from '../runtime/compression-transform.js';
import { defineOverlayTool } from '../tools/overlay.js';
import { createDelegateTaskExecutor, createDelegateTaskToolDefinition, type SpawnChild } from '../capabilities/sub-agent/delegate-task.js';
import { createTodoWriteToolDefinition, createTodoWriteToolExecutor } from '../plugins/tool/builtin/todo-write.js';
import { DefaultTodoService } from '../capabilities/todo/service.js';
import { reduceTokenUsage } from './token-usage/index.js';
import { generateId } from '../shared/generate-id.js';
import { resolveContextWindow } from '../infrastructure/llm/context-window.js';
import type { ArchiveRecord } from '../sdk/storage-provider.js';
import { AgentRunState } from './agent-run-state.js';
import { forkSessionTitleGeneration } from './session-title.js';

export type REMAgentStatus = 'idle' | 'running' | 'finished' | 'error';

const toMessage = (content: UserInputContent): Message =>
  ({ role: 'user', content, timestamp: Date.now() }) as Message;

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface REMAgentParams {
  agentId: string;
  /** 所属持久化 session（子 Agent 有自己的 sessionId） */
  sessionId?: string;
  /** delegate_task 的 task 摘要（用于 child-agent-update） */
  summary?: string;
  /** 以下参数必填；异步解析（配置/systemPrompt/loop 组装）在首次 run/continue 时惰性完成 */
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  session: Session;
  workspace: string;
  /** 角色与 workspaceRoot 覆盖（透传 resolveAgentConfig） */
  agentRoleId?: string;
  workspaceRoot?: string;
  /** 子 Agent 覆盖：跳过内置 system prompt 拼接，直接使用该 system prompt */
  systemPrompt?: string;
  /** 子 Agent 覆盖：maxTurns（缺省用 behavior.maxTurns） */
  maxTurns?: number;
  signal?: AbortSignal;
  spawnChild?: SpawnChild;
}

/**
 * Agent 执行单元 + 事件源：自己持有 transcript / steering / follow-up / abort /
 * maxTurns，直接驱动 pi-agent-core 的无状态 runAgentLoop / runAgentLoopContinue。
 * 使用方式：new REMAgent(params)（同步）→ agent.run(input)；
 * loop 入参（AgentContext / AgentLoopConfig / streamFn / maxTurns）在
 * 首次 run/continue 时惰性组装（ensureInitialized，幂等可重入）。
 * 单次 run 的可变状态与事件归并由 AgentRunState 持有；
 * 输出构造在 agent-output.ts；标题生成触发在 session-title.ts。
 */
export class REMAgent {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly summary?: string;
  readonly children: REMAgent[] = [];
  status: REMAgentStatus = 'idle';
  /** 由父 Agent attachChild 时回填 */
  parentToolCallId?: string;

  /** 惰性初始化所需的装配输入（构造时逐属性赋值） */
  private readonly di: AgentDI;
  private readonly runtimeConfig: AgentRuntimeConfig;
  private readonly session: Session;
  private readonly workspace: string;
  private readonly agentRoleId?: string;
  private readonly workspaceRoot?: string;
  private readonly systemPromptOverride?: string;
  private readonly maxTurnsOverride?: number;
  private readonly spawnChild?: SpawnChild;

  /** 自有上下文（loop 事件回流更新，多 Agent 场景由各自 REMAgent 独立持有） */
  private messages: Message[];

  /** loop 入参（每次 run 前由 assembleLoopParams 重组装）：context / config / streamFn / maxTurns */
  private agentContext?: AgentContext;
  private loopConfig?: AgentLoopConfig;
  private streamFn?: StreamFn;
  private maxTurns?: number;

  private steeringQueue = new PendingMessageQueue('all');
  private followUpQueue = new PendingMessageQueue('one-at-a-time');
  private activeAbort?: AbortController;
  private turns = 0;

  private runState?: AgentRunState;
  private pendingMeta: RemMetaEvent[] = [];
  private initPromise?: Promise<void>;

  constructor(params: REMAgentParams) {
    this.agentId = params.agentId;
    this.sessionId = params.sessionId;
    this.summary = params.summary;
    this.di = params.di;
    this.runtimeConfig = params.runtimeConfig;
    this.session = params.session;
    this.workspace = params.workspace;
    this.agentRoleId = params.agentRoleId;
    this.workspaceRoot = params.workspaceRoot;
    this.systemPromptOverride = params.systemPrompt;
    this.maxTurnsOverride = params.maxTurns;
    this.spawnChild = params.spawnChild;
    this.messages = params.session.conversation.slice();
    params.signal?.addEventListener('abort', () => this.interrupt());
    // 标题生成与 loop 组装无关（自带"已有标题则跳过"守卫）；pre-run meta 由 pendingMeta 缓冲
    forkSessionTitleGeneration({
      di: this.di,
      session: this.session,
      emit: (event) => this.emitMeta(event),
    });
  }

  /** 首次 run/continue 时执行（幂等可重入）：配置解析 → systemPrompt → loop 入参逐项组装 */
  private ensureInitialized(): Promise<void> {
    return (this.initPromise ??= this.assembleLoopParams());
  }
  private async assembleLoopParams(): Promise<void> {
    const resolution = resolveAgentConfig({
      di: this.di,
      runtimeConfig: this.runtimeConfig,
      session: this.session,
      workspace: this.workspace,
      agentRoleId: this.agentRoleId,
      workspaceRoot: this.workspaceRoot,
    });
    // 子 Agent 覆盖：静态 system prompt 优先于 assembler 产物，短路整个 prompt 构建
    const systemPrompt = this.systemPromptOverride
      ?? await resolveSystemPrompt({ di: this.di, runtimeConfig: this.runtimeConfig, resolution });
    const sessionId = this.sessionId ?? this.session.sessionId;
    const { effectiveModel, behavior, configProvider } = resolution;

    const spawnChild: SpawnChild = this.spawnChild ?? (async () => {
      throw new Error('delegate_task is not available for this agent');
    });
    const agentTools = createAgentTools({
      toolProvider: this.di.toolProvider,
      skillProvider: this.di.skillProvider,
      delegateToolProviderEntry: defineOverlayTool(
        createDelegateTaskToolDefinition(),
        createDelegateTaskExecutor({ parentAgent: () => this, spawnChild }),
      ),
      todoToolProviderEntry: defineOverlayTool(
        createTodoWriteToolDefinition(),
        createTodoWriteToolExecutor(
          new DefaultTodoService(this.di.storage.todoStore),
          (event) => this.emitMeta(event),
        ),
      ),
      workspaceRoot: resolution.workspaceRoot,
      agentName: behavior.name,
      sessionId,
    });

    const transformContext = createCompressionTransform({
      compressor: this.di.compressor,
      shouldCompress: (msgs) => this.di.compressor.shouldCompress({ ...this.session, conversation: msgs }),
      estimatedTokens: () => reduceTokenUsage(this.session.metadata.tokenUsageHistory as unknown[] ?? []) ?? 0,
      threshold: () => {
        const maxTokens = resolveContextWindow(effectiveModel.provider, effectiveModel.model, this.runtimeConfig.runtime.env, this.di.models);
        return maxTokens * configProvider.getCompressionConfig().thresholdRatio;
      },
      archive: (before) => this.archiveConversation(sessionId, before),
      // compression-transform 只发 RemMetaEvent；签名按 AgentStreamEvent 收窄到 emitMeta
      emit: (event: AgentStreamEvent) => this.emitMeta(event as RemMetaEvent),
      sessionId,
    });

    const resolved = this.di.models.getModel(effectiveModel.provider, effectiveModel.model);
    if (!resolved) throw new Error(`Unknown model: ${effectiveModel.provider}/${effectiveModel.model}`);

    this.agentContext = {
      systemPrompt,
      messages: this.messages,
      tools: agentTools.tools,
    };
    this.loopConfig = {
      model: effectiveModel.baseURL ? { ...resolved, baseUrl: effectiveModel.baseURL } : resolved,
      reasoning: effectiveModel.reasoning,
      sessionId,
      toolExecution: 'sequential',
      convertToLlm: (messages) =>
        messages.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult') as Message[],
      transformContext: (messages) => transformContext(messages as Message[]),
      getApiKey: () => effectiveModel.apiKey || undefined,
      getSteeringMessages: async () => this.steeringQueue.drain(),
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
    this.streamFn = (m, ctx, options) =>
      this.di.models.streamSimple(m, ctx, {
        ...options,
        apiKey: effectiveModel.apiKey || undefined,
      });
    this.maxTurns = this.maxTurnsOverride ?? behavior.maxTurns;
  }

  /** v2 压缩归档：只写 archiveStore；session.metadata.compressionHistory 由 SessionService 在 compress-end 事件时更新（单一写入方） */
  private async archiveConversation(sessionId: string, before: Message[]): Promise<string> {
    const previousArchive = await this.di.storage.archiveStore.getLatest(sessionId);
    const archiveId = generateId();
    const record: ArchiveRecord = {
      id: archiveId,
      sessionId,
      compressedAt: new Date(),
      version: previousArchive ? previousArchive.version + 1 : 1,
      parentArchiveId: previousArchive?.id,
      conversationSnapshot: before,
      summary: '',
    };
    await this.di.storage.archiveStore.save(record);
    return archiveId;
  }

  /** 当前 run 的事件流（多消费者）；未运行时为 undefined */
  get events(): AsyncIterable<REMAgentEvent> | undefined {
    return this.runState?.queue;
  }

  /** 当前 run 的最终输出 */
  get output(): Promise<AgentOutput> | undefined {
    return this.runState?.outputPromise;
  }

  run(input: UserInput): AsyncIterable<REMAgentEvent> {
    const state = this.beginRun();
    void this.execute(state, async (signal) => {
      await this.ensureInitialized();
      return runAgentLoop(
        [toMessage(input.content)],
        this.createContextSnapshot(),
        this.requireLoopConfig(),
        (event) => this.ingestLoopEvent(event),
        signal,
        this.requireStreamFn(),
      );
    });
    return state.queue;
  }

  /** 不加新消息从当前 transcript 继续；最后一条必须是 user 或 toolResult（assistant 结尾时若有 steering 则改以 steering 续跑） */
  continue(): AsyncIterable<REMAgentEvent> {
    if (this.status === 'running') {
      throw new Error(`REMAgent "${this.agentId}" is already running`);
    }
    const lastMessage = this.messages[this.messages.length - 1];
    if (!lastMessage) {
      throw new Error('No messages to continue from');
    }
    if (lastMessage.role === 'assistant') {
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length === 0) {
        throw new Error('Cannot continue from message role: assistant');
      }
      const state = this.beginRun();
      void this.execute(state, async (signal) => {
        await this.ensureInitialized();
        return runAgentLoop(
          queuedSteering,
          this.createContextSnapshot(),
          this.requireLoopConfig(),
          (event) => this.ingestLoopEvent(event),
          signal,
          this.requireStreamFn(),
        );
      });
      return state.queue;
    }
    const state = this.beginRun();
    void this.execute(state, async (signal) => {
      await this.ensureInitialized();
      return runAgentLoopContinue(
        this.createContextSnapshot(),
        this.requireLoopConfig(),
        (event) => this.ingestLoopEvent(event),
        signal,
        this.requireStreamFn(),
      );
    });
    return state.queue;
  }

  steer(content: UserInputContent): void {
    this.steeringQueue.enqueue(toMessage(content));
  }

  followUp(content: UserInputContent): void {
    this.followUpQueue.enqueue(toMessage(content));
  }

  interrupt(): void {
    this.activeAbort?.abort();
  }

  /** 内部：delegate_task executor 调用，把子 Agent 挂树并广播 child-spawned */
  attachChild(child: REMAgent, parentToolCallId: string): void {
    child.parentToolCallId = parentToolCallId;
    this.children.push(child);
    this.runState?.queue.push({ type: 'child-spawned', child, parentToolCallId });
  }

  /** 内部：装配注入的 meta 事件出口（agent-tools / context-bridge / 标题） */
  emitMeta(event: RemMetaEvent): void {
    // run 前的 meta（如标题生成异步先完成）先缓冲，run 时按序 flush
    if (this.runState) {
      this.runState.queue.push(event);
    } else {
      this.pendingMeta.push(event);
    }
  }

  private beginRun(): AgentRunState {
    if (this.status === 'running') {
      throw new Error(`REMAgent "${this.agentId}" is already running`);
    }
    this.status = 'running';
    const state = new AgentRunState(this.pendingMeta);
    this.pendingMeta = [];
    this.runState = state;
    return state;
  }

  /** 单次 run 生命周期：loop 异常（含组装失败）合成 error assistant 消息事件（与 pi Agent 行为一致），不向外抛 */
  private async execute(state: AgentRunState, body: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    const abortController = new AbortController();
    this.activeAbort = abortController;
    try {
      await body(abortController.signal);
      this.status = state.complete();
    } catch (error) {
      try {
        await this.emitLoopFailure(error, abortController.signal.aborted);
        this.status = state.complete();
      } catch (inner) {
        state.fail(inner);
        this.status = 'error';
      }
    } finally {
      this.activeAbort = undefined;
      state.finish();
    }
  }

  private async emitLoopFailure(error: unknown, aborted: boolean): Promise<void> {
    const model = this.loopConfig?.model;
    const failureMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api: model?.api ?? 'unknown',
      provider: model?.provider ?? 'unknown',
      model: model?.id ?? 'unknown',
      usage: EMPTY_USAGE,
      stopReason: aborted ? 'aborted' : 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } satisfies AssistantMessage;
    await this.ingestLoopEvent({ type: 'message_start', message: failureMessage });
    await this.ingestLoopEvent({ type: 'message_end', message: failureMessage });
    await this.ingestLoopEvent({ type: 'turn_end', message: failureMessage, toolResults: [] });
    await this.ingestLoopEvent({ type: 'agent_end', messages: [failureMessage] });
  }

  /** loop 事件归并：回流更新自有 transcript、计数 maxTurns，再交给 runState 归并 */
  private ingestLoopEvent(event: AgentEvent): void {
    if (event.type === 'message_end') {
      // pi AgentMessage 含 harness 自定义消息；我们的 loop 只产生 pi.Message
      this.messages.push(event.message as Message);
    } else if (event.type === 'turn_end') {
      this.turns += 1;
      if (this.maxTurns !== undefined && this.turns >= this.maxTurns) {
        this.interrupt();
      }
    }
    this.runState?.ingest(event);
  }

  /** 每次调用新鲜快照：messages/tools 切片，避免 loop 内部持有引用被后续回流污染 */
  private createContextSnapshot(): AgentContext {
    const context = this.requireAgentContext();
    return {
      systemPrompt: context.systemPrompt,
      messages: this.messages.slice(),
      tools: (context.tools ?? []).slice(),
    };
  }

  private requireAgentContext(): AgentContext {
    if (!this.agentContext) {
      throw new Error(`REMAgent "${this.agentId}" loop params not assembled`);
    }
    return this.agentContext;
  }

  private requireLoopConfig(): AgentLoopConfig {
    if (!this.loopConfig) {
      throw new Error(`REMAgent "${this.agentId}" loop params not assembled`);
    }
    return this.loopConfig;
  }

  private requireStreamFn(): StreamFn {
    if (!this.streamFn) {
      throw new Error(`REMAgent "${this.agentId}" loop params not assembled`);
    }
    return this.streamFn;
  }
}
