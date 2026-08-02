import type { REMAgentEvent } from '../agent/agent-event.js';

export interface AgentThreadEventSink {
  handle(agentThreadId: string, event: REMAgentEvent): Promise<void>;
}

export class AgentThreadEventDriver {
  constructor(private readonly sink: AgentThreadEventSink) {}

  async drive(agentThreadId: string, events: AsyncIterable<REMAgentEvent>): Promise<void> {
    for await (const event of events) await this.sink.handle(agentThreadId, event);
  }
}
