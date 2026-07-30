import type { AssistantMessage, Message, Usage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AgentOutput, RemMetaEvent } from './types.js';
import { addUsage, emptyUsage } from './token-usage/index.js';
import { generateId } from '../shared/generate-id.js';
import { EventQueue } from './event-queue.js';
import type { REMAgentEvent } from './agent-event.js';
import { agentOutputErrorMessage, buildAgentErrorOutput, buildAgentOutput } from './agent-output.js';

/** 单次 run 的可变状态与事件归并（REMAgent 每次 run 创建一个实例） */
export class AgentRunState {
  readonly queue = new EventQueue<REMAgentEvent>();
  readonly outputPromise: Promise<AgentOutput>;
  private outputResolve?: (output: AgentOutput) => void;
  private totalUsage: Usage = emptyUsage();
  private lastAssistant?: AssistantMessage;
  private lastAssistantMessageId?: string;

  /** run 前缓冲的 meta 事件（如标题）按序 flush 进新队列 */
  constructor(pendingMeta: RemMetaEvent[]) {
    for (const event of pendingMeta) this.queue.push(event);
    this.outputPromise = new Promise<AgentOutput>((resolve) => {
      this.outputResolve = resolve;
    });
  }

  /** pi Agent 事件归并：透传原事件，message_end 追加 message-persist，turn_end 累计 usage */
  ingest(event: AgentEvent): void {
    this.queue.push(event);
    if (event.type === 'message_end') {
      const message = event.message as Message;
      const messageId = generateId();
      if (message.role === 'assistant') {
        this.lastAssistantMessageId = messageId;
      }
      this.queue.push({ type: 'message-persist', message, messageId });
    } else if (event.type === 'turn_end' && (event.message as Message).role === 'assistant') {
      this.lastAssistant = event.message as AssistantMessage;
      this.totalUsage = addUsage(this.totalUsage, this.lastAssistant.usage);
    }
  }

  /** 正常收尾：usage 事件 + finish/error 事件 + resolve output；返回终态 */
  complete(): 'finished' | 'error' {
    this.queue.push({ type: 'usage', usage: this.totalUsage, assistantMessageId: this.lastAssistantMessageId });
    const output = buildAgentOutput(this.lastAssistant);
    if (this.lastAssistant?.stopReason === 'error') {
      this.queue.push({ type: 'error', error: { name: 'AgentError', message: agentOutputErrorMessage(output) } });
      this.outputResolve?.(output);
      return 'error';
    }
    this.queue.push({ type: 'finish', output });
    this.outputResolve?.(output);
    return 'finished';
  }

  /** 异常收尾：error 事件 + resolve 'Error: ...' 输出 */
  fail(error: unknown): void {
    const output = buildAgentErrorOutput(error);
    this.queue.push({ type: 'error', error: { name: 'AgentError', message: agentOutputErrorMessage(output) } });
    this.outputResolve?.(output);
  }

  finish(): void {
    this.queue.finish();
  }
}
