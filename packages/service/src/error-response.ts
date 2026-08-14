import { RuntimeError } from 'rem-agent-core';

const statusByCode: Record<string, number> = {
  INVALID_INPUT: 400,
  TRIGGER_NOT_SUPPORTED: 400,
  CONTEXT_CONFLICT: 400,
  CONTEXT_INVALID: 400,
  CONTEXT_TYPE_NOT_FOUND: 400,
  CONTEXT_UNAUTHORIZED: 403,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  AGENT_NOT_FOUND: 404,
  AGENT_REVISION_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  TOOL_DENIED: 403,
  TOOL_RESULT_UNKNOWN: 409,
  TOOL_EXECUTION_FAILED: 502,
  RUN_CONFLICT: 409,
  RUN_ALREADY_TERMINAL: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STORAGE_CONFLICT: 409,
  STORAGE_UNAVAILABLE: 503,
  MODEL_UNAVAILABLE: 503,
  MODEL_EXECUTION_FAILED: 502,
  PLUGIN_DEPENDENCY_MISSING: 503,
  EXECUTION_TIMEOUT: 504,
  EXECUTION_CANCELLED: 409,
};

export function errorResponse(error: unknown, statusOverride?: number): Response {
  const runtimeError = error instanceof RuntimeError ? error : undefined;
  const status = statusOverride ?? (runtimeError ? statusByCode[runtimeError.code] ?? (runtimeError.retryable ? 503 : 500) : 500);
  const body = runtimeError
    ? { error: { code: runtimeError.code, message: runtimeError.message, retryable: runtimeError.retryable, ...(runtimeError.details === undefined ? {} : { details: runtimeError.details }) } }
    : { error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', retryable: false } };
  return Response.json(body, { status });
}
