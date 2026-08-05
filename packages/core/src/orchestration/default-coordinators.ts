import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import type { AgentCoordinator, AgentCoordinatorSharedDeps } from './agent-coordinator-types.js';
import { MultiAgentCoordinator } from './multi-agent-coordinator.js';
import { SingleAgentCoordinator } from './single-agent-coordinator.js';

export interface DefaultCoordinatorsDeps extends AgentCoordinatorSharedDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  sessionUsecase: SessionUsecase;
}

/** 装配内置的两种 mode coordinator（single / multi-agent），供注册进 AgentCoordinatorResolver。 */
export function createDefaultCoordinators(deps: DefaultCoordinatorsDeps): AgentCoordinator[] {
  const { di, runtimeConfig, sessionUsecase, ...shared } = deps;
  return [
    new SingleAgentCoordinator({ ...shared, sessionUsecase, agentParams: { di, runtimeConfig } }),
    new MultiAgentCoordinator({ ...shared, di, runtimeConfig, sessionUsecase }),
  ];
}
