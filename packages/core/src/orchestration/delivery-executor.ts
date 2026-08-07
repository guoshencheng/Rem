import type { MessageDelivery } from './delivery-model.js';
import type { DiscussionRuntime } from './discussion-runtime.js';
import type { Message } from '@earendil-works/pi-ai';
import type { AgentThreadRuntime } from '../session/agent-thread-runtime.js';
import type { AgentThreadEventDriver } from './agent-thread-event-driver.js';

/** "单条 delivery 如何执行"的端口接口，由 Scheduler 调用、具体执行器实现。 */
export interface DeliveryExecutionPort {
  execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void>;
}

/** DeliveryExecutionPort 的函数包装器实现，便于测试与轻量场景注入执行逻辑。 */
export class DeliveryExecutor implements DeliveryExecutionPort {
  constructor(
    private readonly executeDelivery: (delivery: MessageDelivery, discussion: DiscussionRuntime) => Promise<void>,
  ) {}

  execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void> {
    return this.executeDelivery(delivery, discussion);
  }
}

/** AgentThreadDeliveryExecutor 的依赖：按 delivery 取 AgentThreadRuntime、重投影 transcript、事件驱动器与可选的 beforeRun 钩子。 */
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

/** 生产执行器：取 AgentThreadRuntime → FIFO enqueue 排队 → beforeRun 绑编排工具 → 重投影 transcript → syncTranscript 后驱动 agent.continue()。 */
export class AgentThreadDeliveryExecutor implements DeliveryExecutionPort {
  constructor(private readonly deps: AgentThreadDeliveryExecutorDeps) {}

  async execute(delivery: MessageDelivery, discussion: DiscussionRuntime): Promise<void> {
    const runtime = await this.deps.getRuntime(delivery, discussion);
    await runtime.enqueue(async () => {
      await this.deps.beforeRun?.(runtime, delivery, discussion);
      const transcript = await this.deps.projectTranscript(delivery);
      runtime.agent.syncTranscript(transcript);
      // 无新消息（末尾已是本 thread 的 assistant）：该 delivery 的消息此前已随批次进入上下文，跳过避免无效 continue。
      if (transcript.at(-1)?.role === 'assistant') return;
      await this.deps.eventDriver.drive(delivery.targetAgentThreadId, runtime.agent.continue());
    });
  }
}
