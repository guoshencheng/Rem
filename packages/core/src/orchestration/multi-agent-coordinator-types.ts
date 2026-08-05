import type { AgentDI } from '../assembly/agent-di.js';
import type { AgentRuntimeConfig } from '../assembly/runtime-config.js';
import type { SessionUsecase } from '../session/session-usecase.js';
import type { AgentCoordinatorSharedDeps } from './agent-coordinator-types.js';

export interface MultiAgentCoordinatorDeps extends AgentCoordinatorSharedDeps {
  di: AgentDI;
  runtimeConfig: AgentRuntimeConfig;
  sessionUsecase: SessionUsecase;
}
