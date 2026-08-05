import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { REMAgentEvent } from '../agent/agent-event.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { Session } from '../session/model.js';
import type { SessionRuntime } from '../session/runtime.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import { generateId } from '../shared/generate-id.js';
import type { MessageDelivery } from './delivery-model.js';
import type { MessageDeliveryUsecase } from './delivery-usecase.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import { resolveCommunicationModel } from './multi-agent-actions.js';
import { createSyntheticFailureMessage } from './synthetic-result-message.js';

export interface MultiAgentEventHandlerDeps {
  di: AgentDI;
  sessionUsecase: SessionUsecase;
  threadUsecase: AgentThreadUsecase;
  deliveries: MessageDeliveryUsecase;
  publish(event: AgentSystemEvent): void;
}

/** 多 Agent 事件处理器：把 agent 事件分流到持久化（message-persist/usage 等）、bus 发布（chunk/usage-change/todo-updated）与预算 recordTokens。 */
export class MultiAgentEventHandler {
  constructor(private readonly deps: MultiAgentEventHandlerDeps) {}

  async handle(runtime: SessionRuntime, threadId: string, event: REMAgentEvent): Promise<void> {
    if (event.type === 'message-persist') {
      await this.deps.sessionUsecase.persistAgentEvent(runtime.sessionId, threadId, event);
      return;
    }
    if (event.type === 'usage') {
      await this.deps.sessionUsecase.persistAgentEvent(runtime.sessionId, threadId, event);
      this.deps.publish({ type: 'usage-change', workspace: runtime.workspace,
        sessionId: runtime.sessionId, usage: event.usage });
      runtime.activeDiscussion?.budget.recordTokens(event.usage.totalTokens);
      return;
    }
    if (event.type === 'todo-updated') {
      this.deps.publish({ type: 'todo-updated', workspace: runtime.workspace,
        sessionId: runtime.sessionId, todos: event.todos });
      return;
    }
    if (event.type === 'session-title' || event.type === 'compress-end') {
      await this.deps.sessionUsecase.persistAgentEvent(runtime.sessionId, threadId, event);
    }
    if (event.type === 'error') throw event.error;
    this.deps.publish({ type: 'chunk', workspace: runtime.workspace, sessionId: runtime.sessionId,
      agentId: runtime.threadRuntimes.get(threadId)?.agent.agentId, agentThreadId: threadId, chunk: event });
  }

  /** 执行失败按角色处理：organizer 失败终止整个讨论；member 失败写入 synthetic failure 消息让讨论继续。 */
  async handleFailure(
    session: Session,
    delivery: MessageDelivery,
    error: unknown,
    discussion: DiscussionRuntime,
  ): Promise<void> {
    const thread = await this.deps.threadUsecase.get(delivery.targetAgentThreadId);
    if (!thread || thread.sessionId !== session.sessionId) {
      throw new Error(`AgentThread not found: ${delivery.targetAgentThreadId}`);
    }
    if (thread.role === 'organizer') {
      discussion.status = 'failed';
      await this.deps.deliveries.interruptRoot(session.sessionId, discussion.rootUserMessageId);
      return;
    }
    await this.deps.di.sessionProvider.appendMessage(session, {
      message: createSyntheticFailureMessage(resolveCommunicationModel(this.deps.di, session, thread), error),
      messageId: generateId(), author: { type: 'agent', agentThreadId: thread.agentThreadId },
      scope: { type: 'session' }, rootUserMessageId: discussion.rootUserMessageId,
    });
    discussion.budget.recordMessage();
  }
}
