import type { AgentRun } from '../domain/run/types.js';
import type { AgentSession } from '../domain/session/types.js';
import type { RunSignalSource } from '../domain/event/types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';

export function signalSource(run: AgentRun): RunSignalSource | undefined {
  const participant = run.executionPlanSnapshot?.participantSnapshots.find((candidate) =>
    candidate.agentId === run.agentId && candidate.revision === run.agentRevision
      && (candidate.role === 'root' || candidate.role === 'organizer' || candidate.role === 'member'));
  if (!participant || run.rootNodeId === undefined) return undefined;
  const role = run.rootNodeId.includes(':delegated:') ? 'delegated' : participant.role;
  return { nodeId: run.rootNodeId, agentId: participant.agentId, role };
}

export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RuntimeError('EXECUTION_CANCELLED', 'Run execution cancelled');
}

export function assertRunSessionOwnership(run: AgentRun, session: AgentSession): void {
  if (run.sessionId !== session.sessionId || run.tenantId !== session.tenantId) {
    throw new RuntimeError('RUN_CONFLICT', 'Run and session ownership do not match');
  }
}
