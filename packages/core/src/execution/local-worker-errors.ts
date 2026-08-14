import { RuntimeError } from '../application/runtime/runtime-error.js';

export function stableWorkerError(error: unknown): RuntimeError {
  return error instanceof RuntimeError
    ? error
    : new RuntimeError('INTERNAL_ERROR', 'Local worker operation failed', false, undefined, { cause: error });
}
