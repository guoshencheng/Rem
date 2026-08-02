import type { REMAgent } from '../agent/rem-agent.js';
import { SessionAlreadyRunningError } from '../system/errors.js';
import type { ResolvedOrchestrationConfig } from '../sdk/config-provider.js';
import { AgentThreadRuntime } from './agent-thread-runtime.js';
import { AgentThreadRuntimeRegistry } from './agent-thread-runtime-registry.js';
import { DiscussionRuntime } from '../orchestration/discussion-runtime.js';

export type SessionRuntimeStatus = 'idle' | 'running' | 'error';

export interface SessionRuntimeParams {
  sessionId: string;
  workspace: string;
  agentThreadId: string;
  rootAgent: REMAgent;
  mode?: 'single' | 'multi-agent';
}

/** 一个持久化 Session 对应的进程内执行所有权。 */
export class SessionRuntime {
  readonly sessionId: string;
  readonly workspace: string;
  readonly agentThreadId: string;
  readonly rootAgent: REMAgent;
  readonly mode: 'single' | 'multi-agent';
  readonly threadRuntimes = new AgentThreadRuntimeRegistry();
  activeDiscussion?: DiscussionRuntime;
  status: SessionRuntimeStatus = 'idle';
  private runController?: AbortController;

  constructor(params: SessionRuntimeParams) {
    this.sessionId = params.sessionId;
    this.workspace = params.workspace;
    this.agentThreadId = params.agentThreadId;
    this.rootAgent = params.rootAgent;
    this.mode = params.mode ?? 'single';
    const now = new Date();
    this.threadRuntimes.register(new AgentThreadRuntime({
      agentThreadId: params.agentThreadId, sessionId: params.sessionId, agentId: 'default',
      role: 'primary', lifecycle: 'persistent', createdAt: now, updatedAt: now,
    }, params.rootAgent));
  }

  startRun(): AbortSignal {
    if (this.status === 'running') throw new SessionAlreadyRunningError(this.sessionId);
    this.runController = new AbortController();
    this.status = 'running';
    return this.runController.signal;
  }

  finishRun(): void {
    this.runController = undefined;
    this.status = 'idle';
  }

  failRun(): void {
    this.runController = undefined;
    this.status = 'error';
  }

  interrupt(): void {
    this.runController?.abort();
    this.activeDiscussion?.interrupt();
    this.threadRuntimes.interruptAll();
  }

  startDiscussion(rootUserMessageId: string, config: ResolvedOrchestrationConfig): DiscussionRuntime {
    if (this.activeDiscussion && ['running', 'finishing'].includes(this.activeDiscussion.status)) {
      throw new SessionAlreadyRunningError(this.sessionId);
    }
    return (this.activeDiscussion = new DiscussionRuntime(rootUserMessageId, config));
  }

  finishDiscussion(): void { this.activeDiscussion = undefined; }
}
