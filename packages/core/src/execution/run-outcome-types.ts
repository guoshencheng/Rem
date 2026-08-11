import type { RunExecutionResult } from './run-executor.js';
import type { InterruptReason } from './run-execution-control.js';

export type ExecutionOutcome =
  | { kind: 'success'; result: RunExecutionResult }
  | { kind: 'error'; error: unknown }
  | { kind: 'interrupt'; reason: InterruptReason };
