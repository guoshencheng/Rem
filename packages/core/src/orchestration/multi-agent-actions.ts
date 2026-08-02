import type { AgentDI } from '../assembly/agent-di.js';
import type { ResolvedTeam } from '../sdk/agent-role.js';
import type { AgentThread } from '../session/agent-thread/model.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { Session } from '../session/model.js';
import { generateId } from '../shared/generate-id.js';
import { createCommunicationMessage, type CommunicationModelIdentity } from './communication-message.js';
import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { AgentOrchestrationActions } from './orchestration-actions.js';
import { BUDGET_SUMMARY_BATCH_PREFIX } from './scheduler.js';

export interface MultiAgentActionsInput {
  di: AgentDI;
  session: Session;
  team: ResolvedTeam;
  callerThread: AgentThread;
  delivery: MessageDelivery;
  discussion: DiscussionRuntime;
  threadUsecase: AgentThreadUsecase;
}

export function createMultiAgentActions(input: MultiAgentActionsInput): AgentOrchestrationActions {
  return {
    sendMessage: async ({ toAgentIds, content }) => {
      if (input.discussion.status !== 'running') throw new Error('Discussion no longer accepts messages');
      if (input.delivery.batchId.startsWith(BUDGET_SUMMARY_BATCH_PREFIX)) {
        throw new Error('send_message is disabled during the restricted budget summary');
      }
      const budgetReason = input.discussion.budget.check(input.delivery.depth + 1);
      if (budgetReason) throw new Error(`Discussion budget exhausted: ${budgetReason}`);
      const allowed = new Set([input.team.organizer.id, ...input.team.members.map(({ id }) => id)]);
      const targetIds = [...new Set(toAgentIds)];
      if (targetIds.includes(input.callerThread.agentId)) throw new Error('Agent cannot send_message to itself');
      const unknown = targetIds.find((id) => !allowed.has(id));
      if (unknown) throw new Error(`Agent is not a member of this Team: ${unknown}`);
      const threads = await input.threadUsecase.listBySession(input.session.sessionId);
      const targets = targetIds.map((id) => {
        const thread = threads.find((item) => item.agentId === id && item.lifecycle === 'persistent');
        if (!thread) throw new Error(`AgentThread not found for configured agent: ${id}`);
        return thread;
      });
      const batchId = generateId();
      const messageId = generateId();
      const now = new Date();
      const message = createCommunicationMessage(resolveCommunicationModel(input.di, input.session, input.callerThread), content);
      const deliveries: MessageDelivery[] = targets.map((target) => ({
        deliveryId: generateId(), sessionId: input.session.sessionId, kind: 'message', batchId, messageId,
        rootUserMessageId: input.delivery.rootUserMessageId, targetAgentThreadId: target.agentThreadId,
        requestedByAgentThreadId: input.callerThread.agentThreadId, status: 'queued', attempt: 0,
        depth: input.delivery.depth + 1, createdAt: now, updatedAt: now,
      }));
      await input.di.sessionProvider.appendMessageWithDeliveries(input.session, {
        message, messageId, author: { type: 'agent', agentThreadId: input.callerThread.agentThreadId },
        scope: { type: 'session' }, mentions: targets.map(({ agentThreadId }) => agentThreadId),
        rootUserMessageId: input.delivery.rootUserMessageId,
      }, deliveries);
      input.discussion.budget.recordMessage();
      return { batchId };
    },
    ...(input.callerThread.role === 'organizer' ? {
      finishDiscussion: async (answer: string) => {
        input.discussion.requestFinish(input.callerThread.agentThreadId, answer);
      },
    } : {}),
  };
}

export function resolveCommunicationModel(
  di: AgentDI,
  session: Session,
  thread: AgentThread,
): CommunicationModelIdentity {
  const workspace = (session.metadata.workspace as string | undefined) ?? 'default';
  const config = di.configProvider.forWorkspace?.(workspace) ?? di.configProvider;
  const role = config.resolveAgent(thread.agentId);
  const resolved = role.model ?? config.getModelConfig();
  const model = di.models.getModel(resolved.provider, resolved.model);
  if (!model) throw new Error(`Unknown model: ${resolved.provider}/${resolved.model}`);
  return model as CommunicationModelIdentity;
}
