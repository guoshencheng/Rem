import type { Message } from '@earendil-works/pi-ai';
import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { BroadcastBus } from '../agent/broadcast-bus.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { TeamInfo } from '../sdk/config-provider.js';
import type { AgentCoordinatorResolver } from '../orchestration/coordinator-resolver.js';
import type { SessionInfo } from '../session/manager/types.js';
import type { SessionRuntimeRegistry } from '../session/runtime-registry.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { SessionAgentContextUsecase } from '../session/session-agent-context-usecase.js';
import type { AgentSystem, CreateSessionInput, SendMessageInput } from './types.js';
import { streamSystemEvents } from './event-stream.js';
import { projectSessionChat } from '../session/messages/session-chat-projector.js';

export interface CoreAgentSystemDeps {
  bus: BroadcastBus;
  registry: SessionRuntimeRegistry;
  sessionUsecase: SessionUsecase;
  threadUsecase: AgentThreadUsecase;
  contextUsecase: SessionAgentContextUsecase;
  coordinators: AgentCoordinatorResolver;
  di: AgentDI;
}

/** Core Agent 用例门面：按 Session mode 分发到对应 coordinator，自身不持有 mode 分支。 */
export class CoreAgentSystem implements AgentSystem {
  private recovery?: Promise<number>;

  constructor(private readonly deps: CoreAgentSystemDeps) {}

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    await this.ensureRecovery();
    const info = await this.deps.sessionUsecase.create(input.workspace, input.teamId);
    if (input.teamId) {
      const config = this.deps.di.configProvider.forWorkspace?.(input.workspace)
        ?? this.deps.di.configProvider;
      await this.deps.threadUsecase.ensureTeamThreads(info.sessionId, config.resolveTeam(input.teamId));
    }
    return info;
  }

  async listTeams(): Promise<TeamInfo[]> {
    return this.deps.di.configProvider.listTeams();
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
      this.deps.di.sessionProvider.listEntries(sessionId),
      this.deps.di.sessionProvider.getActiveLeafId(sessionId),
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
    const coordinator = this.deps.coordinators.forSession(session);
    const runtime = await this.deps.registry.getOrCreate(input.sessionId, () =>
      coordinator.createRuntime(session, workspace));
    await coordinator.send(session, runtime, input.content as Message['content']);
  }

  async interrupt(sessionId: string): Promise<void> {
    const runtime = this.deps.registry.get(sessionId);
    if (!runtime) return;
    await this.deps.coordinators.forRuntime(runtime).interrupt(runtime);
  }

  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent> {
    return streamSystemEvents(this.deps.bus, signal);
  }

  private ensureRecovery(): Promise<number> {
    return (this.recovery ??= Promise.all([
      this.deps.sessionUsecase.recoverInterruptedDelegations(),
      ...[...this.deps.coordinators.all()].map((coordinator) => coordinator.recoverProcessing()),
    ]).then(([delegations, ...counts]) => delegations + counts.reduce((sum, n) => sum + n, 0)));
  }
}
