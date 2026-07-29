import type { Message } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';

/**
 * REMAgent 依赖的 pi-agent 最小面（结构类型）。
 * 生产环境由 pi-agent-core 的 Agent 实例满足；测试用手写 fake。
 */
export interface PiAgentLike {
  subscribe(listener: (event: AgentEvent) => void | Promise<void>): () => void;
  prompt(message: Message): Promise<void>;
  steer(message: Message): void;
  followUp(message: Message): void;
  abort(): void;
}
