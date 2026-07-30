import type { Message } from '@earendil-works/pi-ai';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { BusEvent } from './bus-events.js';
import type { Session } from '../session/model.js';
import type { AgentOutput, RemMetaEvent, UserInput, UserInputContent } from './types.js';
import type { ApprovalRequest } from '../sdk/agent-state-provider.js';
import type { ApprovalEngine } from '../security/approval/approval-engine.js';
import type { PiAgentLike } from '../runtime/pi-agent-like.js';
import type { REMAgentEvent } from './agent-event.js';
import type { REMAgentContext } from './context/types.js';
import { assemblePiAgent } from '../runtime/assemble-pi-agent.js';
import type { SpawnChild } from '../capabilities/sub-agent/delegate-task.js';
import { AgentRunState } from './agent-run-state.js';
import { forkSessionTitleGeneration } from './session-title.js';

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
 * 无状态执行单元 + 事件源：负责公开生命周期操作与协作编排。
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

  private readonly agent: PiAgentLike;
  private runState?: AgentRunState;
  private pendingMeta: RemMetaEvent[] = [];

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
      forkSessionTitleGeneration({
        di: params.di,
        session: params.session,
        emit: (event) => this.emitMeta(event),
      });
    }
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
    if (this.status === 'running') {
      throw new Error(`REMAgent "${this.agentId}" is already running`);
    }
    this.status = 'running';
    const state = new AgentRunState(this.pendingMeta);
    this.pendingMeta = [];
    this.runState = state;

    this.agent.subscribe((event) => state.ingest(event));

    void (async () => {
      try {
        await this.agent.prompt(toMessage(input.content));
        this.status = state.complete();
      } catch (error) {
        state.fail(error);
        this.status = 'error';
      } finally {
        state.finish();
      }
    })();

    return state.queue;
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
    this.runState?.queue.push({ type: 'child-spawned', child, parentToolCallId });
  }

  /** 内部：装配注入的 meta 事件出口（tool-bridge / context-bridge / 标题） */
  emitMeta(event: RemMetaEvent): void {
    // run 前的 meta（如标题生成异步先完成）先缓冲，run 时按序 flush
    if (this.runState) {
      this.runState.queue.push(event);
    } else {
      this.pendingMeta.push(event);
    }
  }
}
