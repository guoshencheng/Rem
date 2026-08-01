import type { REMAgent } from '../agent/rem-agent.js';
import { SessionAlreadyRunningError } from '../system/errors.js';

export type SessionRuntimeStatus = 'idle' | 'running' | 'error';

export interface SessionRuntimeParams {
  sessionId: string;
  workspace: string;
  agentThreadId: string;
  rootAgent: REMAgent;
}

/** 一个持久化 Session 对应的进程内执行所有权。 */
export class SessionRuntime {
  readonly sessionId: string;
  readonly workspace: string;
  readonly agentThreadId: string;
  readonly rootAgent: REMAgent;
  status: SessionRuntimeStatus = 'idle';
  private runController?: AbortController;

  constructor(params: SessionRuntimeParams) {
    this.sessionId = params.sessionId;
    this.workspace = params.workspace;
    this.agentThreadId = params.agentThreadId;
    this.rootAgent = params.rootAgent;
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
    this.rootAgent.interrupt();
  }
}
