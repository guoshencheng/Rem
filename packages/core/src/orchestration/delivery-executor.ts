import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentThreadRuntime } from '../session/agent-thread-runtime.js';
import type { AgentThreadEventDriver } from './agent-thread-event-driver.js';

export interface DeliveryExecutionPort {
  execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void>;
}

export class DeliveryExecutor implements DeliveryExecutionPort {
  constructor(
    private readonly executeDelivery: (delivery: MessageDelivery, discussion: DiscussionRuntime) => Promise<void>,
  ) {}

  execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void> {
    return this.executeDelivery(delivery, discussion);
  }
}

export interface AgentThreadDeliveryExecutorDeps {
  getRuntime(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<AgentThreadRuntime>;
  projectTranscript(delivery: MessageDelivery): Promise<Message[]>;
  eventDriver: AgentThreadEventDriver;
  beforeRun?(
    runtime: AgentThreadRuntime,
    delivery: MessageDelivery,
    discussion: DiscussionRuntime,
  ): Promise<void> | void;
}

export class AgentThreadDeliveryExecutor implements DeliveryExecutionPort {
  constructor(private readonly deps: AgentThreadDeliveryExecutorDeps) {}

  async execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void> {
    const runtime = await this.deps.getRuntime(delivery, discussion);
    await runtime.enqueue(async () => {
      await this.deps.beforeRun?.(runtime, delivery, discussion);
      const transcript = await this.deps.projectTranscript(delivery);
      runtime.agent.syncTranscript(transcript);
      await this.deps.eventDriver.drive(delivery.targetAgentThreadId, runtime.agent.continue());
    });
  }
}
