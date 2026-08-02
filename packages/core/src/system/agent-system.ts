import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { BroadcastBus } from '../agent/broadcast-bus.js';
import type { AgentRunDriver } from '../agent/agent-run-driver.js';
import type { SessionInfo } from '../session/manager/types.js';
import type { SessionRuntimeRegistry } from '../session/runtime-registry.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import type { DelegationRunner } from '../delegation/runner.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { SessionAgentContextUsecase } from '../session/session-agent-context-usecase.js';
import type { Session } from '../session/model.js';
import type {
  AgentSystem, CreateSessionInput, RootAgentFactory, SendMessageInput,
} from './types.js';
import { SessionRuntime } from '../session/runtime.js';
import { streamSystemEvents } from './event-stream.js';
import { projectSessionChat } from '../session/messages/session-chat-projector.js';
import type { MultiAgentCoordinator } from '../orchestration/multi-agent-coordinator.js';

export interface CoreAgentSystemDeps {
  bus: BroadcastBus;
  driver: AgentRunDriver;
  registry: SessionRuntimeRegistry;
  sessionUsecase: SessionUsecase;
  threadUsecase: AgentThreadUsecase;
  contextUsecase: SessionAgentContextUsecase;
  createRootAgent: RootAgentFactory;
  delegationRunner: DelegationRunner;
  agentParams: Pick<Parameters<RootAgentFactory>[0], 'di' | 'runtimeConfig'>;
  multiAgentCoordinator: MultiAgentCoordinator;
}

/** Core 单 Agent 用例门面。 */
export class CoreAgentSystem implements AgentSystem {
  private recovery?: Promise<number>;

  constructor(private readonly deps: CoreAgentSystemDeps) {}

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    await this.ensureRecovery();
    const info = await this.deps.sessionUsecase.create(input.workspace, input.teamId);
    if (input.teamId) {
      const config = this.deps.agentParams.di.configProvider.forWorkspace?.(input.workspace)
        ?? this.deps.agentParams.di.configProvider;
      await this.deps.threadUsecase.ensureTeamThreads(info.sessionId, config.resolveTeam(input.teamId));
    }
    return info;
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    await this.ensureRecovery();
    return this.deps.sessionUsecase.get(sessionId);
  }

  async listSessions(workspace: string): Promise<SessionInfo[]> {
    await this.ensureRecovery();
    return this.deps.sessionUsecase.list(workspace);
  }

  async getSessionThreads(sessionId: string) {
    await this.deps.sessionUsecase.requireSession(sessionId);
    return this.deps.threadUsecase.listBySession(sessionId);
  }

  async getSessionChat(sessionId: string) {
    const session = await this.deps.sessionUsecase.requireSession(sessionId);
    const threads = await this.deps.threadUsecase.listBySession(sessionId);
    const primary = threads.find((thread) => thread.role === 'primary' || thread.role === 'organizer');
    const [entries, leafId] = await Promise.all([
      this.deps.agentParams.di.sessionProvider.listEntries(sessionId),
      this.deps.agentParams.di.sessionProvider.getActiveLeafId(sessionId),
    ]);
    return projectSessionChat(entries, leafId, primary?.agentThreadId ?? session.sessionId);
  }

  async getAgentThreadContext(sessionId: string, agentThreadId: string) {
    const session = await this.deps.sessionUsecase.requireSession(sessionId);
    const thread = await this.deps.threadUsecase.get(agentThreadId);
    if (!thread || thread.sessionId !== sessionId) throw new Error(`AgentThread does not belong to Session: ${agentThreadId}`);
    return (await this.deps.contextUsecase.projectSession(session, thread)).conversation;
  }

  async send(input: SendMessageInput): Promise<void> {
    await this.ensureRecovery();
    const session = await this.deps.sessionUsecase.requireSession(input.sessionId);
    const workspace = (session.metadata.workspace as string | undefined) ?? 'default';
    const runtime = await this.deps.registry.getOrCreate(input.sessionId, () =>
      this.createRuntime(session, workspace));
    if (session.metadata.mode === 'multi-agent') {
      await this.deps.multiAgentCoordinator.send(session, runtime, input.content as import('@earendil-works/pi-ai').Message['content']);
      return;
    }
    runtime.startRun();
    try {
      const agent = runtime.rootAgent;
      this.publish(runtime, { type: 'session-start' });
      this.publish(runtime, { type: 'activity-change', activity: 'pending' });
      const events = agent.run({ content: input.content, timestamp: new Date() });
      void this.deps.driver.drive(runtime, agent, events);
    } catch (error) {
      runtime.failRun();
      this.publish(runtime, {
        type: 'session-error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    const runtime = this.deps.registry.get(sessionId);
    if (!runtime) return;
    if (runtime.mode === 'multi-agent') await this.deps.multiAgentCoordinator.interrupt(runtime);
    else runtime.interrupt();
  }

  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent> {
    return streamSystemEvents(this.deps.bus, signal);
  }

  private ensureRecovery(): Promise<number> {
    return (this.recovery ??= Promise.all([
      this.deps.sessionUsecase.recoverInterruptedDelegations(),
      this.deps.multiAgentCoordinator.recoverProcessing(),
    ]).then(([delegations, deliveries]) => delegations + deliveries));
  }

  private async createRuntime(session: Session, workspace: string): Promise<SessionRuntime> {
    if (session.metadata.mode === 'multi-agent') {
      return this.deps.multiAgentCoordinator.createRuntime(session, workspace);
    }
    const thread = await this.deps.threadUsecase.ensurePrimaryThread(
      session.sessionId,
      'default',
    );
    const projectedSession = await this.deps.contextUsecase.projectSession(session, thread);
    const rootAgent = this.deps.createRootAgent({
      ...this.deps.agentParams,
      session: projectedSession,
      workspace,
      workspaceRoot: workspace,
      agentId: 'root',
      sessionId: session.sessionId,
      runDelegation: (request, toolContext) => this.deps.delegationRunner.run(request, {
        parentSessionId: session.sessionId,
        parentAgentThreadId: thread.agentThreadId,
        parentToolCallId: toolContext.toolCallId ?? 'unknown',
        workspace,
        workspaceRoot: toolContext.workspaceRoot,
        depth: 1,
        signal: toolContext.signal,
      }),
    });
    return new SessionRuntime({
      sessionId: session.sessionId,
      workspace,
      agentThreadId: thread.agentThreadId,
      rootAgent,
    });
  }

  private publish(
    runtime: SessionRuntime,
    event: { type: 'session-start' }
      | { type: 'activity-change'; activity: 'pending' }
      | { type: 'session-error'; error: string },
  ): void {
    this.deps.bus.publish({ ...event, sessionId: runtime.sessionId, workspace: runtime.workspace });
  }
}
