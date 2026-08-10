export const RUNTIME_ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'AGENT_NOT_FOUND',
  'AGENT_REVISION_NOT_FOUND',
  'TRIGGER_NOT_SUPPORTED',
  'SESSION_NOT_FOUND',
  'RUN_NOT_FOUND',
  'RUN_CONFLICT',
  'RUN_ALREADY_TERMINAL',
  'CONTEXT_TYPE_NOT_FOUND',
  'CONTEXT_INVALID',
  'CONTEXT_CONFLICT',
  'CONTEXT_UNAUTHORIZED',
  'PLUGIN_DEPENDENCY_MISSING',
  'TOOL_NOT_FOUND',
  'TOOL_DENIED',
  'TOOL_EXECUTION_FAILED',
  'TOOL_RESULT_UNKNOWN',
  'MODEL_UNAVAILABLE',
  'MODEL_EXECUTION_FAILED',
  'STORAGE_CONFLICT',
  'STORAGE_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'EXECUTION_TIMEOUT',
  'EXECUTION_CANCELLED',
  'INTERNAL_ERROR',
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

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
