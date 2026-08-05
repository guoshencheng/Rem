import type { Message } from '@earendil-works/pi-ai';
import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { DelegationRunner } from '../delegation/runner.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { SessionAgentContextUsecase } from '../session/session-agent-context-usecase.js';
import type { Session } from '../session/model.js';
import type { SessionRuntime } from '../session/runtime.js';
import type { RootAgentFactory } from '../system/types.js';

export type SessionMode = 'single' | 'multi-agent';

/** 一种 Session 模式的运行时协调器：驱动该模式下 Agent 的创建、执行、中断与恢复。 */
export interface AgentCoordinator {
  readonly mode: SessionMode;
  createRuntime(session: Session, workspace: string): Promise<SessionRuntime>;
  send(session: Session, runtime: SessionRuntime, content: Message['content']): Promise<void>;
  interrupt(runtime: SessionRuntime): Promise<void>;
  recoverProcessing(): Promise<number>;
}

/** 所有 coordinator 的共享依赖：Agent 创建统一走 createRootAgent 工厂。 */
export interface AgentCoordinatorSharedDeps {
  createRootAgent: RootAgentFactory;
  delegationRunner: DelegationRunner;
  threadUsecase: AgentThreadUsecase;
  contextUsecase: SessionAgentContextUsecase;
  publish(event: AgentSystemEvent): void;
}
