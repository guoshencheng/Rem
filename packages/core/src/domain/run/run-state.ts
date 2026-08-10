import type { RunStatus } from './types.js';

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'waiting'],
  waiting: ['queued', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function transitionRun(current: RunStatus, next: RunStatus): RunStatus {
  if (!transitions[current].includes(next)) {
    throw new Error(`Illegal run transition: ${current} -> ${next}`);
  }

  return next;
}

export const isTerminalRunStatus = (status: RunStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'cancelled';
