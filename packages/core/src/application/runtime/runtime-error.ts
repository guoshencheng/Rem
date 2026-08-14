import { RUNTIME_ERROR_CODES, type RuntimeErrorCode } from '../../domain/error/types.js';

export { RUNTIME_ERROR_CODES, type RuntimeErrorCode };

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}
