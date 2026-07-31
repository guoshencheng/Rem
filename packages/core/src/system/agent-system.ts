import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { BroadcastBus } from '../agent/broadcast-bus.js';
import type { AgentRunDriver } from '../agent/agent-run-driver.js';
import type { SessionInfo } from '../session/manager/types.js';
import type { SessionRuntimeRegistry } from '../session/runtime-registry.js';
import type { SessionService } from '../session/service.js';
import type { DelegationRunner } from '../delegation/runner.js';
import type {
  AgentSystem, CreateSessionInput, RootAgentFactory, SendMessageInput,
} from './types.js';
import { SessionRuntime } from '../session/runtime.js';
import { streamSystemEvents } from './event-stream.js';

export interface CoreAgentSystemDeps {
  bus: BroadcastBus;
  driver: AgentRunDriver;
  registry: SessionRuntimeRegistry;
  sessionService: SessionService;
  createRootAgent: RootAgentFactory;
  delegationRunner: DelegationRunner;
  agentParams: Pick<Parameters<RootAgentFactory>[0], 'di' | 'runtimeConfig'>;
}

/** Core 单 Agent 用例门面。 */
export class CoreAgentSystem implements AgentSystem {
  private recovery?: Promise<number>;

  constructor(private readonly deps: CoreAgentSystemDeps) {}

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    await this.ensureRecovery();
    return this.deps.sessionService.create(input.workspace);
  }

  async getSession(sessionId: string): Promise<SessionInfo> {
    await this.ensureRecovery();
    return this.deps.sessionService.get(sessionId);
  }

  async listSessions(workspace: string): Promise<SessionInfo[]> {
    await this.ensureRecovery();
    return this.deps.sessionService.list(workspace);
  }

  async send(input: SendMessageInput): Promise<void> {
    await this.ensureRecovery();
    const session = await this.deps.sessionService.requireSession(input.sessionId);
    const workspace = (session.metadata.workspace as string | undefined) ?? 'default';
    const runtime = await this.deps.registry.getOrCreate(input.sessionId, async () =>
      new SessionRuntime({ sessionId: input.sessionId, workspace }));
    runtime.startRun();
    try {
      const agent = runtime.getOrCreateRootAgent(() => this.deps.createRootAgent({
        ...this.deps.agentParams,
        session,
        workspace,
        workspaceRoot: workspace,
        agentId: 'root',
        sessionId: input.sessionId,
        runDelegation: (request, toolContext) => this.deps.delegationRunner.run(request, {
          parentSessionId: input.sessionId,
          parentToolCallId: toolContext.toolCallId ?? 'unknown',
          workspace,
          workspaceRoot: toolContext.workspaceRoot,
          depth: 1,
          signal: toolContext.signal,
        }),
      }));
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
    this.deps.registry.get(sessionId)?.interrupt();
  }

  events(signal?: AbortSignal): AsyncIterable<AgentSystemEvent> {
    return streamSystemEvents(this.deps.bus, signal);
  }

  private ensureRecovery(): Promise<number> {
    return (this.recovery ??= this.deps.sessionService.recoverInterruptedDelegations());
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
