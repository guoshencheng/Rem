import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentOutput, RemMetaEvent, UserInput, UserInputContent } from 'rem-agent-core';
import { addUsage, emptyUsage, generateId } from 'rem-agent-core';
import { EventQueue } from './event-queue.js';
import type { PiAgentLike } from './pi-agent-like.js';
import type { REMAgentEvent } from './rem-agent-event.js';

export type REMAgentStatus = 'idle' | 'running' | 'finished' | 'error';

const toMessage = (content: UserInputContent): Message =>
  ({ role: 'user', content, timestamp: Date.now() }) as Message;

export interface REMAgentParams {
  agentId: string;
  agent: PiAgentLike;
  /** 所属持久化 session（子 Agent 有自己的 sessionId） */
  sessionId?: string;
  /** delegate_task 的 task 摘要（用于 child-agent-update） */
  summary?: string;
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
  private totalUsage: Usage = emptyUsage();
  private lastAssistant?: AssistantMessage;
  private lastAssistantMessageId?: string;
  private outputResolve?: (output: AgentOutput) => void;
  private outputPromise?: Promise<AgentOutput>;

  constructor(params: REMAgentParams) {
    this.agentId = params.agentId;
    this.agent = params.agent;
    this.sessionId = params.sessionId;
    this.summary = params.summary;
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

  /** 内部：装配工厂注入的 meta 事件出口（tool-bridge / context-bridge / 标题） */
  emitMeta(event: RemMetaEvent): void {
    this.queue?.push(event);
  }
}
