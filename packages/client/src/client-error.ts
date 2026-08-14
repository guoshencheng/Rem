import type { RuntimeErrorCode } from 'rem-agent-core';

export class RuntimeClientError extends Error {
  constructor(
    readonly code: RuntimeErrorCode | string,
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeClientError';
  }
}
