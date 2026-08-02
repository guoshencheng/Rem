import type { Message } from '@earendil-works/pi-ai';
import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { REMAgent, REMAgentParams } from '../agent/rem-agent.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { DelegationRunner } from '../delegation/runner.js';
import type { ResolvedTeam } from '../sdk/agent-role.js';
import type { AgentThread } from '../session/agent-thread/model.js';
import { AgentThreadRuntime } from '../session/agent-thread-runtime.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { Session } from '../session/model.js';
import { SessionRuntime } from '../session/runtime.js';
import type { SessionAgentContextUsecase } from '../session/session-agent-context-usecase.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import { generateId } from '../shared/generate-id.js';
import { AgentThreadDeliveryExecutor } from './delivery-executor.js';
import { MessageDeliveryUsecase } from './delivery-usecase.js';
import type { MessageDelivery } from './delivery-model.js';
import { AgentThreadEventDriver } from './agent-thread-event-driver.js';
import { createCommunicationMessage } from './communication-message.js';
import { createMultiAgentActions, resolveCommunicationModel } from './multi-agent-actions.js';
import { OrchestrationActionBinding } from './orchestration-action-binding.js';
import { OrchestrationScheduler } from './scheduler.js';

export interface MultiAgentCoordinatorDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  sessionUsecase: SessionUsecase;
  threadUsecase: AgentThreadUsecase;
  contextUsecase: SessionAgentContextUsecase;
  delegationRunner: DelegationRunner;
  createAgent(params: REMAgentParams): REMAgent;
  publish(event: AgentSystemEvent): void;
}

export class MultiAgentCoordinator {
  private readonly bindings = new Map<string, OrchestrationActionBinding>();
  private readonly deliveries: MessageDeliveryUsecase;

  constructor(private readonly deps: MultiAgentCoordinatorDeps) {
    this.deliveries = new MessageDeliveryUsecase(deps.di.storage.messageDeliveryStore);
  }

  async createRuntime(session: Session, workspace: string): Promise<SessionRuntime> {
    const team = this.resolveTeam(session, workspace);
    const organizer = (await this.deps.threadUsecase.listBySession(session.sessionId))
      .find((thread) => thread.role === 'organizer');
    if (!organizer) throw new Error(`Organizer AgentThread not found: ${session.sessionId}`);
    const threadRuntime = await this.createThreadRuntime(session, workspace, organizer);
    return new SessionRuntime({ sessionId: session.sessionId, workspace,
      agentThreadId: organizer.agentThreadId, rootAgent: threadRuntime.agent,
      mode: 'multi-agent', initialThread: organizer });
  }

  async send(session: Session, runtime: SessionRuntime, content: Message['content']): Promise<void> {
    const team = this.resolveTeam(session, runtime.workspace);
    const organizer = runtime.threadRuntimes.values()[0]?.thread;
    if (!organizer) throw new Error(`Organizer AgentThread not loaded: ${session.sessionId}`);
    runtime.startRun();
    try {
      const rootUserMessageId = generateId();
      const now = new Date();
      const initial: MessageDelivery = { deliveryId: generateId(), sessionId: session.sessionId,
        kind: 'message', batchId: generateId(), messageId: rootUserMessageId, rootUserMessageId,
        targetAgentThreadId: organizer.agentThreadId, status: 'queued', attempt: 0, depth: 0,
        createdAt: now, updatedAt: now };
      await this.deps.di.sessionProvider.appendMessageWithDeliveries(session, {
        message: { role: 'user', content, timestamp: now.getTime() } as Message,
        messageId: rootUserMessageId, author: { type: 'user' }, scope: { type: 'session' },
        rootUserMessageId,
      }, [initial]);
      const config = (this.deps.di.configProvider.forWorkspace?.(runtime.workspace)
        ?? this.deps.di.configProvider).getOrchestrationConfig();
      const discussion = runtime.startDiscussion(rootUserMessageId, config);
      this.publish(runtime, { type: 'session-start' });
      this.deps.publish({ type: 'discussion-change', workspace: runtime.workspace,
        sessionId: runtime.sessionId, rootUserMessageId, status: 'running' });
      const scheduler = this.createScheduler(session, runtime, team);
      await scheduler.drive(session.sessionId, discussion);
      if (discussion.status !== 'completed' || !discussion.finishRequest) {
        throw new Error('Multi-agent discussion ended without a final answer');
      }
      await this.persistFinalAnswer(session, organizer, discussion.finishRequest.answer, rootUserMessageId);
      await this.deps.sessionUsecase.completeDiscussion(session.sessionId);
      this.deps.publish({ type: 'discussion-change', workspace: runtime.workspace,
        sessionId: runtime.sessionId, rootUserMessageId, status: 'completed' });
      runtime.finishRun();
      runtime.finishDiscussion();
      this.publish(runtime, { type: 'session-end' });
    } catch (error) {
      runtime.failRun();
      runtime.finishDiscussion();
      this.publish(runtime, { type: 'session-error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private createScheduler(session: Session, runtime: SessionRuntime, team: ResolvedTeam): OrchestrationScheduler {
    const eventDriver = new AgentThreadEventDriver({ handle: (threadId, event) =>
      this.handleAgentEvent(runtime, threadId, event) });
    const executor = new AgentThreadDeliveryExecutor({
      getRuntime: async (delivery) => runtime.threadRuntimes.getOrCreate(delivery.targetAgentThreadId, async () => {
        const thread = await this.requireThread(session.sessionId, delivery.targetAgentThreadId);
        return this.createThreadRuntime(session, runtime.workspace, thread);
      }),
      projectTranscript: async (delivery) => {
        const thread = await this.requireThread(session.sessionId, delivery.targetAgentThreadId);
        return (await this.deps.contextUsecase.projectSession(session, thread)).conversation;
      },
      beforeRun: (threadRuntime, delivery, discussion) => {
        this.bindings.get(threadRuntime.thread.agentThreadId)?.bind(createMultiAgentActions({
          di: this.deps.di, session, team, callerThread: threadRuntime.thread,
          delivery, discussion, threadUsecase: this.deps.threadUsecase,
        }));
      },
      eventDriver,
    });
    return new OrchestrationScheduler({ deliveries: this.deliveries, executor,
      maxParallelAgents: discussionLimit(this.deps.di, runtime.workspace),
      onDeliveryChange: (delivery) => this.deps.publish({ type: 'delivery-change',
        workspace: runtime.workspace, sessionId: runtime.sessionId, delivery }),
    });
  }

  private async createThreadRuntime(session: Session, workspace: string, thread: AgentThread): Promise<AgentThreadRuntime> {
    const binding = new OrchestrationActionBinding(thread.role === 'organizer');
    this.bindings.set(thread.agentThreadId, binding);
    const projected = await this.deps.contextUsecase.projectSession(session, thread);
    const agent = this.deps.createAgent({ di: this.deps.di, runtimeConfig: this.deps.runtimeConfig,
      session: projected, workspace, workspaceRoot: workspace, agentId: thread.agentId,
      agentRoleId: thread.agentId, sessionId: session.sessionId, orchestrationActions: binding.actions,
      runDelegation: (request, toolContext) => this.deps.delegationRunner.run(request, {
        parentSessionId: session.sessionId, parentAgentThreadId: thread.agentThreadId,
        parentToolCallId: toolContext.toolCallId ?? 'unknown', workspace,
        workspaceRoot: toolContext.workspaceRoot, depth: 1, signal: toolContext.signal,
      }) });
    return new AgentThreadRuntime(thread, agent);
  }

  private async handleAgentEvent(runtime: SessionRuntime, threadId: string, event: import('../agent/agent-event.js').REMAgentEvent): Promise<void> {
    if (event.type === 'message-persist') {
      await this.deps.sessionUsecase.persistAgentEvent(runtime.sessionId, threadId, event);
      return;
    }
    if (event.type === 'usage') {
      await this.deps.sessionUsecase.persistAgentEvent(runtime.sessionId, threadId, event);
      this.deps.publish({ type: 'usage-change', workspace: runtime.workspace,
        sessionId: runtime.sessionId, usage: event.usage });
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

  private async persistFinalAnswer(session: Session, organizer: AgentThread, answer: string, rootId: string): Promise<void> {
    await this.deps.di.sessionProvider.appendMessage(session, {
      message: createCommunicationMessage(resolveCommunicationModel(this.deps.di, session, organizer), answer),
      messageId: generateId(), author: { type: 'agent', agentThreadId: organizer.agentThreadId },
      scope: { type: 'session' }, rootUserMessageId: rootId,
    });
  }

  private resolveTeam(session: Session, workspace: string): ResolvedTeam {
    const teamId = session.metadata.teamId as string | undefined;
    if (!teamId) throw new Error(`Multi-agent Session has no teamId: ${session.sessionId}`);
    const config = this.deps.di.configProvider.forWorkspace?.(workspace) ?? this.deps.di.configProvider;
    return config.resolveTeam(teamId);
  }

  private async requireThread(sessionId: string, threadId: string): Promise<AgentThread> {
    const thread = await this.deps.threadUsecase.get(threadId);
    if (!thread || thread.sessionId !== sessionId) throw new Error(`AgentThread not found: ${threadId}`);
    return thread;
  }

  private publish(runtime: SessionRuntime, event: { type: 'session-start' | 'session-end' } | { type: 'session-error'; error: string }): void {
    this.deps.publish({ ...event, workspace: runtime.workspace, sessionId: runtime.sessionId });
  }
}

function discussionLimit(di: AgentDI, workspace: string): number {
  return (di.configProvider.forWorkspace?.(workspace) ?? di.configProvider)
    .getOrchestrationConfig().maxParallelAgents;
}
