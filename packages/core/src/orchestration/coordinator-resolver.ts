import type { Session } from '../session/model.js';
import type { SessionRuntime } from '../session/runtime.js';
import type { AgentCoordinator, SessionMode } from './agent-coordinator-types.js';

export function resolveSessionMode(session: Session): SessionMode {
  return session.metadata.mode === 'multi-agent' ? 'multi-agent' : 'single';
}

export class AgentCoordinatorResolver {
  private readonly coordinators = new Map<SessionMode, AgentCoordinator>();

  constructor(coordinators: AgentCoordinator[]) {
    for (const coordinator of coordinators) this.coordinators.set(coordinator.mode, coordinator);
  }

  forSession(session: Session): AgentCoordinator {
    return this.require(resolveSessionMode(session));
  }

  forRuntime(runtime: SessionRuntime): AgentCoordinator {
    return this.require(runtime.mode);
  }

  all(): IterableIterator<AgentCoordinator> {
    return this.coordinators.values();
  }

  private require(mode: SessionMode): AgentCoordinator {
    const coordinator = this.coordinators.get(mode);
    if (!coordinator) throw new Error(`No AgentCoordinator registered for mode: ${mode}`);
    return coordinator;
  }
}
