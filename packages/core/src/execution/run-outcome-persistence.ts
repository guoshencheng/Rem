import type { WorkItem } from '../domain/run/types.js';
import type { RunExecutionResult } from './run-executor.js';
import type { RunCompletion } from './run-completion.js';
import type { ExecutionOutcome } from './run-outcome-types.js';
import { RuntimeError } from '../application/runtime/runtime-error.js';
import { executionFailure, storageFailure } from './local-worker-options.js';
import { validateRunOutput } from './run-output-validation.js';

export class RunOutcomePersistence {
  constructor(private readonly completion: RunCompletion) {}

  async persist(claimed: WorkItem, outcome: ExecutionOutcome): Promise<void> {
    if (outcome.kind === 'success') {
      await this._persistSuccess(claimed, outcome.result);
      return;
    }
    const executorFailure = outcome.kind === 'error' ? executionFailure(outcome.error) : undefined;
    const failure = outcome.kind === 'interrupt'
      ? { code: outcome.reason === 'timeout' ? 'EXECUTION_TIMEOUT' as const
          : outcome.reason === 'cancelled' ? 'EXECUTION_CANCELLED' as const : 'RUN_CONFLICT' as const,
          retryable: outcome.reason === 'lease-lost', cancelled: outcome.reason === 'cancelled' }
      : { ...executorFailure!, cancelled: executorFailure!.code === 'EXECUTION_CANCELLED' };
    try {
      const applied = await this.completion.fail(claimed, failure);
      if (!applied) throw leaseConflict();
    } catch (error) { throw storageFailure(error); }
  }

  private async _persistSuccess(claimed: WorkItem, result: RunExecutionResult): Promise<void> {
    let output;
    try { output = validateRunOutput(result); }
    catch {
      try {
        const applied = await this.completion.fail(claimed, { code: 'INTERNAL_ERROR', retryable: false });
        if (!applied) throw leaseConflict();
      } catch (failureError) { throw storageFailure(failureError); }
      return;
    }
    try {
      const applied = await this.completion.succeed(claimed, output);
      if (!applied) throw leaseConflict();
    } catch (error) { throw storageFailure(error); }
  }
}

const leaseConflict = (): RuntimeError =>
  new RuntimeError('RUN_CONFLICT', 'Execution lease is no longer valid', true);
