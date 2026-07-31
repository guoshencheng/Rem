import type { REMAgent } from '../agent/rem-agent.js';
import { SessionAlreadyRunningError } from '../system/errors.js';

export type SessionRuntimeStatus = 'idle' | 'running' | 'error';

export interface SessionRuntimeParams {
  sessionId: string;
  workspace: string;
}

/** 一个持久化 Session 对应的进程内执行所有权。 */
export class SessionRuntime {
  readonly sessionId: string;
  readonly workspace: string;
  status: SessionRuntimeStatus = 'idle';
  private root?: REMAgent;
  private runController?: AbortController;

  constructor(params: SessionRuntimeParams) {
    this.sessionId = params.sessionId;
    this.workspace = params.workspace;
  }

  get rootAgent(): REMAgent | undefined {
    return this.root;
  }

  getOrCreateRootAgent(create: () => REMAgent): REMAgent {
    return (this.root ??= create());
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
    this.root?.interrupt();
  }
}
