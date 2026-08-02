import type { REMAgent } from '../agent/rem-agent.js';
import type { AgentThread } from './agent-thread/model.js';

export type AgentThreadRuntimeStatus = 'idle' | 'queued' | 'running' | 'error';

export class AgentThreadRuntime {
  status: AgentThreadRuntimeStatus = 'idle';
  private tail: Promise<unknown> = Promise.resolve();

  constructor(readonly thread: AgentThread, readonly agent: REMAgent) {}

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (this.status !== 'running') this.status = 'queued';
    const operation = this.tail.catch(() => undefined).then(async () => {
      this.status = 'running';
      try {
        const result = await run();
        this.status = 'idle';
        return result;
      } catch (error) {
        this.status = 'error';
        throw error;
      }
    });
    this.tail = operation;
    return operation;
  }

  interrupt(): void { this.agent.interrupt(); }
}
