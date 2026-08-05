import type { Message } from '@earendil-works/pi-ai';
import type { REMAgentParams } from '../agent/rem-agent.js';
import type { UserInputContent } from '../agent/types.js';
import type { Session } from '../session/model.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import { SessionRuntime } from '../session/runtime.js';
import type { AgentCoordinator, AgentCoordinatorSharedDeps, SessionMode } from './agent-coordinator-types.js';
import { SingleAgentRunDriver } from './single-agent-run-driver.js';

export interface SingleAgentCoordinatorDeps extends AgentCoordinatorSharedDeps {
  sessionUsecase: SessionUsecase;
  agentParams: Pick<REMAgentParams, 'di' | 'runtimeConfig'>;
}

/** 单 Agent 协调器：一个 REMAgent 一次 run 到底。 */
export class SingleAgentCoordinator implements AgentCoordinator {
  readonly mode: SessionMode = 'single';
  private readonly driver: SingleAgentRunDriver;

  constructor(private readonly deps: SingleAgentCoordinatorDeps) {
    this.driver = new SingleAgentRunDriver({
      sessionUsecase: deps.sessionUsecase,
      publish: deps.publish,
    });
  }

  async createRuntime(session: Session, workspace: string): Promise<SessionRuntime> {
    const thread = await this.deps.threadUsecase.ensurePrimaryThread(session.sessionId, 'default');
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

  async send(_session: Session, runtime: SessionRuntime, content: Message['content']): Promise<void> {
    runtime.startRun();
    try {
      const agent = runtime.rootAgent;
      this.publish(runtime, { type: 'session-start' });
      this.publish(runtime, { type: 'activity-change', activity: 'pending' });
      const events = agent.run({ content: content as UserInputContent, timestamp: new Date() });
      void this.driver.drive(runtime, agent, events);
    } catch (error) {
      runtime.failRun();
      this.publish(runtime, {
        type: 'session-error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async interrupt(runtime: SessionRuntime): Promise<void> {
    runtime.interrupt();
  }

  recoverProcessing(): Promise<number> {
    return Promise.resolve(0);
  }

  private publish(
    runtime: SessionRuntime,
    event: { type: 'session-start' }
      | { type: 'activity-change'; activity: 'pending' }
      | { type: 'session-error'; error: string },
  ): void {
    this.deps.publish({ ...event, sessionId: runtime.sessionId, workspace: runtime.workspace });
  }
}
