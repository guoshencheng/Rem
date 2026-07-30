import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentDI } from './agent-di.js';
import type { AgentRuntimeConfig } from './agent-runtime-config.js';
import type { BusEvent } from './bus-events.js';
import type { Session } from './session/model.js';
import type { AgentOutput, RemMetaEvent, UserInput, UserInputContent } from './types.js';
import type { ApprovalRequest } from './sdk/agent-state-provider.js';
import type { ApprovalEngine } from './security/approval/approval-engine.js';
import { addUsage, emptyUsage } from './token-usage.js';
import { generateId } from './shared/generate-id.js';
import { log } from './infrastructure/observability/debug-log.js';
import { EventQueue } from './event-queue.js';
import type { PiAgentLike } from './pi-agent-like.js';
import type { REMAgentEvent } from './rem-agent-event.js';
import type { REMAgentContext } from './agent-context.js';
import { assemblePiAgent } from './assemble-pi-agent.js';
import type { SpawnChild } from './delegate-task-v2.js';

export type REMAgentStatus = 'idle' | 'running' | 'finished' | 'error';

const toMessage = (content: UserInputContent): Message =>
  ({ role: 'user', content, timestamp: Date.now() }) as Message;

/** tool-bridge 审批链路需要的最小 live state 面（由 bridge 的 REMSession 满足） */
export interface ApprovalStateLike {
  approvalEngine: ApprovalEngine;
  pendingApprovals: ApprovalRequest[];
}

export interface REMAgentParams {
  agentId: string;
  /** 所属持久化 session（子 Agent 有自己的 sessionId） */
  sessionId?: string;
  /** delegate_task 的 task 摘要（用于 child-agent-update） */
  summary?: string;
  /** 测试注入：跳过内部装配直接使用该 pi agent */
  agent?: PiAgentLike;
  /** 以下参数在 agent 缺省时必填；context 由 resolveREMAgentContext 预解析 */
  context?: REMAgentContext;
  di?: AgentDI;
  runtimeConfig?: AgentRuntimeConfig;
  session?: Session;
  workspace?: string;
  signal?: AbortSignal;
  approvalState?: { getOrCreate(sessionId: string): ApprovalStateLike };
  publishBus?: (event: BusEvent) => void;
  spawnChild?: SpawnChild;
}

/**
 * 无状态执行单元 + 事件源。
 * 不碰存储、不持有总线、不持有 session 内存状态；
 * 通过 REMAgentEvent 把一切产出交给上层（bridge-v2 AgentService）。
 */
export class REMAgent {
  readonly agentId: string;
  readonly sessionId?: string;
  readonly summary?: string;
  readonly children: REMAgent[] = [];
  status: REMAgentStatus = 'idle';
  /** 由父 Agent attachChild 时回填 */
  parentToolCallId?: string;

  private readonly agent: PiAgentLike;
  private queue?: EventQueue<REMAgentEvent>;
  private pendingMeta: RemMetaEvent[] = [];
  private totalUsage: Usage = emptyUsage();
  private lastAssistant?: AssistantMessage;
  private lastAssistantMessageId?: string;
  private outputResolve?: (output: AgentOutput) => void;
  private outputPromise?: Promise<AgentOutput>;

  constructor(params: REMAgentParams) {
    this.agentId = params.agentId;
    this.sessionId = params.sessionId;
    this.summary = params.summary;
    if (params.agent) {
      this.agent = params.agent;
    } else {
      if (!params.context || !params.di || !params.runtimeConfig || !params.session ||
          !params.workspace || !params.approvalState || !params.publishBus) {
        throw new Error('REMAgent requires either an injected agent or full assembly params (context/di/runtimeConfig/session/workspace/approvalState/publishBus)');
      }
      this.agent = assemblePiAgent({
        di: params.di,
        runtimeConfig: params.runtimeConfig,
        context: params.context,
        session: params.session,
        sessionId: params.sessionId ?? params.session.sessionId,
        workspace: params.workspace,
        signal: params.signal,
        approvalState: params.approvalState,
        publishBus: params.publishBus,
        spawnChild: params.spawnChild,
        parent: this,
        emitMeta: (event) => this.emitMeta(event),
      });
      this.forkTitleGeneration(params.di, params.session);
    }
  }

  /** 当前 run 的事件流（多消费者）；未运行时为 undefined */
  get events(): AsyncIterable<REMAgentEvent> | undefined {
    return this.queue;
  }

  /** 当前 run 的最终输出 */
  get output(): Promise<AgentOutput> | undefined {
    return this.outputPromise;
  }

  run(input: UserInput): AsyncIterable<REMAgentEvent> {
    if (this.status === 'running') {
      throw new Error(`REMAgent "${this.agentId}" is already running`);
    }
    this.status = 'running';
    const queue = new EventQueue<REMAgentEvent>();
    this.queue = queue;
    for (const event of this.pendingMeta) queue.push(event);
    this.pendingMeta = [];
    this.outputPromise = new Promise<AgentOutput>((resolve) => {
      this.outputResolve = resolve;
    });

    this.agent.subscribe((event) => {
      queue.push(event);
      if (event.type === 'message_end') {
        const message = event.message as Message;
        const messageId = generateId();
        if (message.role === 'assistant') {
          this.lastAssistantMessageId = messageId;
        }
        queue.push({ type: 'message-persist', message, messageId });
      } else if (event.type === 'turn_end' && (event.message as Message).role === 'assistant') {
        this.lastAssistant = event.message as AssistantMessage;
        this.totalUsage = addUsage(this.totalUsage, this.lastAssistant.usage);
      }
    });

    void (async () => {
      try {
        await this.agent.prompt(toMessage(input.content));
        queue.push({ type: 'usage', usage: this.totalUsage, assistantMessageId: this.lastAssistantMessageId });

        if (this.lastAssistant?.stopReason === 'error') {
          const errorMessage = this.lastAssistant.errorMessage ?? 'agent stream error';
          this.status = 'error';
          queue.push({ type: 'error', error: { name: 'AgentError', message: errorMessage } });
          this.outputResolve?.({ content: `Error: ${errorMessage}`, completed: true });
        } else {
          const content =
            this.lastAssistant?.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join('') ?? '';
          this.status = 'finished';
          queue.push({ type: 'finish', output: { content, completed: true } });
          this.outputResolve?.({ content, completed: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.status = 'error';
        queue.push({ type: 'error', error: { name: 'AgentError', message } });
        this.outputResolve?.({ content: `Error: ${message}`, completed: true });
      } finally {
        queue.finish();
      }
    })();

    return queue;
  }

  steer(content: UserInputContent): void {
    this.agent.steer(toMessage(content));
  }

  followUp(content: UserInputContent): void {
    this.agent.followUp(toMessage(content));
  }

  interrupt(): void {
    this.agent.abort();
  }

  /** 内部：delegate_task executor 调用，把子 Agent 挂树并广播 child-spawned */
  attachChild(child: REMAgent, parentToolCallId: string): void {
    child.parentToolCallId = parentToolCallId;
    this.children.push(child);
    this.queue?.push({ type: 'child-spawned', child, parentToolCallId });
  }

  /** 内部：装配注入的 meta 事件出口（tool-bridge / context-bridge / 标题） */
  emitMeta(event: RemMetaEvent): void {
    // run 前的 meta（如标题生成异步先完成）先缓冲，run 时按序 flush
    if (this.queue) {
      this.queue.push(event);
    } else {
      this.pendingMeta.push(event);
    }
  }

  /** 标题生成（原 forkTitleGeneration）：发事件，由 SessionService 落盘 */
  private forkTitleGeneration(di: AgentDI, session: Session): void {
    if (session.metadata.title) return;
    void (async () => {
      try {
        const title = await di.titleProvider.generateTitle(session.conversation);
        if (title) {
          log('title', 'generated', { sessionId: session.sessionId, title });
          this.emitMeta({ type: 'session-title', title });
        }
      } catch {
        log('title', 'failed', { sessionId: session.sessionId });
      }
    })();
  }
}
