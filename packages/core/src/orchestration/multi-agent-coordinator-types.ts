import type { AgentSystemEvent } from '../agent/bus-events.js';
import type { REMAgent, REMAgentParams } from '../agent/rem-agent.js';
import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { DelegationRunner } from '../delegation/runner.js';
import type { AgentThreadUsecase } from '../session/agent-thread/agent-thread-usecase.js';
import type { SessionAgentContextUsecase } from '../session/session-agent-context-usecase.js';
import type { SessionUsecase } from '../session/session-usecase.js';

export interface MultiAgentCoordinatorDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  sessionUsecase: SessionUsecase;
  threadUsecase: AgentThreadUsecase;
  contextUsecase: SessionAgentContextUsecase;
  delegationRunner: DelegationRunner;
  createAgent(params: REMAgentParams): REMAgent;
  publish(event: AgentSystemEvent): void;
}
